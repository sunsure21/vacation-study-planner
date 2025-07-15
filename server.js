require('dotenv').config();
const express = require('express');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const nodemailer = require('nodemailer');
const { saveUserData, getUserData, getAllUserData, deleteUserData } = require('./lib/kv');

const app = express();
const port = 3001;

// Vercel 환경에서 프록시 신뢰 설정
if (process.env.VERCEL) {
    app.set('trust proxy', 1);
}

// 세션 설정 - OAuth 친화적 설정
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-here',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { 
        secure: process.env.VERCEL ? true : false, // HTTPS에서 secure 필요
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7일로 연장
        sameSite: process.env.VERCEL ? 'none' : 'lax', // OAuth cross-site 요청 허용
        // domain 설정은 Vercel에서 자동 처리하므로 제거
    },
    name: 'vacation_planner_session'
}));

// Passport 설정
app.use(passport.initialize());
app.use(passport.session());

// Passport 세션 직렬화/역직렬화 설정
passport.serializeUser((user, done) => {
    console.log('🔐 사용자 직렬화:', user.email);
    done(null, user); // 전체 사용자 객체를 세션에 저장
});

passport.deserializeUser((user, done) => {
    console.log('🔐 사용자 역직렬화:', user.email);
    done(null, user); // 저장된 사용자 객체를 그대로 반환
});

// Google OAuth 전략 설정
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'your_google_client_id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'your_google_client_secret',
    callbackURL: process.env.VERCEL ? "https://vacation-study-planner.vercel.app/auth/google/callback" : "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
    // 사용자 정보를 세션에 저장
    const user = {
        id: profile.id,
        email: profile.emails[0].value, // 원본 이메일 주소 유지
        name: profile.displayName,
        picture: profile.photos[0].value
    };
    
    // 기존 사용자인지 확인 (사용자별 데이터가 하나라도 있으면 기존 사용자)
    try {
        const userEmail = user.email;
        const vacationResult = await getUserData(userEmail, 'vacationPeriod');
        const schedulesResult = await getUserData(userEmail, 'schedules');
        const studyResult = await getUserData(userEmail, 'studyRecords');
        const completedResult = await getUserData(userEmail, 'completedSchedules');
        
        // 모든 데이터 조회 결과를 로그로 확인
        console.log(`🔍 사용자 데이터 확인: ${user.email}`);
        console.log('vacationResult:', { success: vacationResult.success, hasData: !!vacationResult.data, data: vacationResult.data });
        console.log('schedulesResult:', { success: schedulesResult.success, hasData: !!schedulesResult.data, dataLength: schedulesResult.data ? (Array.isArray(schedulesResult.data) ? schedulesResult.data.length : 'not array') : 'null' });
        console.log('studyResult:', { success: studyResult.success, hasData: !!studyResult.data, dataKeys: studyResult.data ? Object.keys(studyResult.data).length : 'null' });
        console.log('completedResult:', { success: completedResult.success, hasData: !!completedResult.data, dataKeys: completedResult.data ? Object.keys(completedResult.data).length : 'null' });
        
        // 데이터가 실제로 존재하는지 확인 (success이고 data가 null이 아닌 경우)
        const hasExistingData = (vacationResult.success && vacationResult.data) ||
                               (schedulesResult.success && schedulesResult.data) ||
                               (studyResult.success && studyResult.data) ||
                               (completedResult.success && completedResult.data);
        
        console.log(`📊 기존 데이터 존재 여부: ${hasExistingData}`);
        
        // 신규 사용자일 때만 회원가입 알림 메일 발송
        if (!hasExistingData) {
            await sendWelcomeEmail(user);
            console.log(`🆕 신규 사용자 가입: ${user.name} (${user.email}) - 알림 메일 발송`);
        } else {
            console.log(`👤 기존 사용자 로그인: ${user.name} (${user.email}) - 기존 데이터 발견, 알림 메일 발송 안함`);
        }
    } catch (error) {
        console.error('사용자 확인 또는 메일 발송 오류:', error);
    }
    
    return done(null, user);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

// 메일 발송 함수
async function sendWelcomeEmail(user) {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    const mailOptions = {
        from: process.env.SMTP_USER,
        to: process.env.NOTIFICATION_EMAIL || 'wyou@wonderslab.kr',
        subject: '방학 순공 플래너 - 새로운 사용자 가입',
        html: `
            <h2>새로운 사용자가 가입했습니다!</h2>
            <p><strong>이름:</strong> ${user.name}</p>
            <p><strong>이메일:</strong> ${user.email}</p>
            <p><strong>가입 시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
            <p><strong>서비스:</strong> 방학 순공 플래너</p>
        `
    };

    await transporter.sendMail(mailOptions);
}

// Gemini AI 설정
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // JSON 요청 본문을 파싱하기 위해 추가

// favicon 404 에러 방지
app.get('/favicon.ico', (req, res) => {
    res.status(204).send();
});

// 인증 미들웨어
function requireAuth(req, res, next) {
    const isAuth = req.isAuthenticated();
    const userEmail = req.user ? req.user.email : null;
    const hasSession = !!req.session;
    const hasPassportData = !!(req.session && req.session.passport);
    
    console.log(`🛡️ 인증 미들웨어 체크:`);
    console.log(`  - 요청 URL: ${req.url}`);
    console.log(`  - 세션 ID: ${req.sessionID}`);
    console.log(`  - 세션 존재: ${hasSession}`);
    console.log(`  - Passport 데이터: ${hasPassportData}`);
    console.log(`  - 인증 상태: ${isAuth}`);
    console.log(`  - 사용자: ${userEmail}`);
    console.log(`  - req.user:`, req.user);
    console.log(`  - req.session.passport:`, req.session.passport);
    
    if (isAuth && req.user) {
        console.log(`✅ 인증 통과 - ${userEmail}`);
        return next();
    }
    
    console.log(`❌ 인증 실패 - /login으로 리다이렉트`);
    console.log(`  - 실패 이유: isAuth=${isAuth}, hasUser=${!!req.user}`);
    res.redirect('/login');
}

// 라우팅
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/planner', requireAuth, (req, res) => {
    console.log(`📄 /planner 페이지 접근 - 사용자: ${req.user ? req.user.email : '없음'}`);
    console.log(`🔐 인증 상태: ${req.isAuthenticated()}`);
    res.sendFile(path.join(__dirname, 'planner.html'));
});

// 세션 체크 API
app.get('/check-session', (req, res) => {
    const isAuth = req.isAuthenticated();
    const sessionID = req.sessionID;
    const hasUser = !!req.user;
    const userEmail = req.user ? req.user.email : null;
    const hasSession = !!req.session;
    const hasPassportData = !!(req.session && req.session.passport);
    
    console.log(`🔍 세션 체크 요청:`);
    console.log(`  - 세션 ID: ${sessionID}`);
    console.log(`  - 세션 존재: ${hasSession}`);
    console.log(`  - Passport 데이터 존재: ${hasPassportData}`);
    console.log(`  - 인증 상태: ${isAuth}`);
    console.log(`  - 사용자 존재: ${hasUser}`);
    console.log(`  - 사용자 이메일: ${userEmail}`);
    console.log(`  - 쿠키:`, req.headers.cookie);
    console.log(`  - 세션 전체:`, req.session);
    console.log(`  - Passport 데이터:`, req.session.passport);
    
    if (isAuth && hasUser) {
        console.log(`✅ 세션 유효 - 사용자: ${userEmail}`);
    } else {
        console.log(`❌ 세션 무효 - 인증되지 않음`);
        console.log(`  - 실패 이유: isAuth=${isAuth}, hasUser=${hasUser}`);
    }
    
    res.json({ authenticated: isAuth && hasUser, user: userEmail });
});

// 사용자 정보 API
app.get('/api/user', requireAuth, (req, res) => {
    res.json(req.user);
});

// 디버깅용: 사용자 데이터 존재 여부 확인 API
app.get('/api/debug/user-data', requireAuth, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const vacationResult = await getUserData(userEmail, 'vacationPeriod');
        const schedulesResult = await getUserData(userEmail, 'schedules');
        const studyResult = await getUserData(userEmail, 'studyRecords');
        const completedResult = await getUserData(userEmail, 'completedSchedules');
        
        res.json({
            email: userEmail,
            dataStatus: {
                vacationPeriod: { success: vacationResult.success, hasData: !!vacationResult.data },
                schedules: { success: schedulesResult.success, hasData: !!schedulesResult.data },
                studyRecords: { success: studyResult.success, hasData: !!studyResult.data },
                completedSchedules: { success: completedResult.success, hasData: !!completedResult.data }
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 임시 디버그 엔드포인트 - KV 데이터 정리용
app.get('/api/debug/cleanup-user/:email', async (req, res) => {
    try {
        const userEmail = decodeURIComponent(req.params.email);
        console.log(`🧹 사용자 데이터 정리 시작: ${userEmail}`);
        
        const dataTypes = ['vacationPeriod', 'schedules', 'studyRecords', 'completedSchedules'];
        const cleanupResults = {};
        
        for (const dataType of dataTypes) {
            try {
                const key = `user:${userEmail}:${dataType}`;
                const { Redis } = require('@upstash/redis');
                const kvStore = Redis.fromEnv();
                
                // 원본 데이터 확인
                const rawData = await kvStore.get(key);
                console.log(`🔍 ${key} 원본:`, typeof rawData, rawData);
                
                if (rawData && typeof rawData === 'string' && rawData.includes('[object Object]')) {
                    // 잘못된 데이터 삭제
                    await kvStore.del(key);
                    console.log(`🗑️ 잘못된 데이터 삭제: ${key}`);
                    cleanupResults[dataType] = 'deleted_invalid_data';
                } else if (rawData) {
                    cleanupResults[dataType] = 'data_ok';
                } else {
                    cleanupResults[dataType] = 'no_data';
                }
            } catch (error) {
                console.error(`❌ ${dataType} 정리 오류:`, error);
                cleanupResults[dataType] = `error: ${error.message}`;
            }
        }
        
        res.json({
            success: true,
            userEmail,
            cleanupResults
        });
    } catch (error) {
        console.error('데이터 정리 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 사용자 데이터 저장 API
app.post('/api/user/data/:dataType', requireAuth, async (req, res) => {
    try {
        const { dataType } = req.params;
        const userEmail = req.user.email;
        const data = req.body;
        
        const result = await saveUserData(userEmail, dataType, data);
        
        if (result.success) {
            res.json({ success: true, message: '데이터가 저장되었습니다.' });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('데이터 저장 API 오류:', error);
        res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
    }
});

// 사용자 데이터 조회 API
app.get('/api/user/data/:dataType', requireAuth, async (req, res) => {
    try {
        const { dataType } = req.params;
        const userEmail = req.user.email;
        
        const result = await getUserData(userEmail, dataType);
        
        if (result.success) {
            res.json({ success: true, data: result.data });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('데이터 조회 API 오류:', error);
        res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
    }
});

// 사용자 전체 데이터 조회 API
app.get('/api/user/data', requireAuth, async (req, res) => {
    try {
        const userEmail = req.user.email;
        console.log(`📊 전체 데이터 조회 요청: ${userEmail}`);
        
        const result = await getAllUserData(userEmail);
        console.log(`📊 전체 데이터 조회 결과:`, { success: result.success, hasData: !!result.data });
        
        if (result.success) {
            res.json({ success: true, data: result.data });
        } else {
            console.error('getAllUserData 실패:', result.error);
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('전체 데이터 조회 API 오류:', error);
        res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
    }
});

// 사용자 데이터 삭제 API
app.delete('/api/user/data/:dataType', requireAuth, async (req, res) => {
    try {
        const { dataType } = req.params;
        const userEmail = req.user.email;
        
        const result = await deleteUserData(userEmail, dataType);
        
        if (result.success) {
            res.json({ success: true, message: '데이터가 삭제되었습니다.' });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('데이터 삭제 API 오류:', error);
        res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
    }
});

// Google OAuth 라우트
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', 
    passport.authenticate('google', { 
        failureRedirect: '/login',
        failureMessage: true 
    }),
    (req, res) => {
        console.log(`🔐 OAuth 콜백 처리 시작 - 사용자: ${req.user ? req.user.email : '없음'}`);
        console.log(`📋 세션 ID: ${req.sessionID}`);
        console.log(`✅ 인증 상태: ${req.isAuthenticated()}`);
        
        // 세션에 사용자 정보가 제대로 저장되었는지 확인
        if (!req.user) {
            console.error('❌ 사용자 정보가 없습니다');
            return res.redirect('/login?error=no_user');
        }
        
        // 명시적으로 세션에 사용자 정보 저장 및 확인
        console.log(`🔧 수동 세션 설정 전:`, req.session.passport);
        req.session.passport = req.session.passport || {};
        req.session.passport.user = req.user;
        console.log(`🔧 수동 세션 설정 후:`, req.session.passport);
        console.log(`🔧 isAuthenticated 상태:`, req.isAuthenticated());
        
        // 세션 저장을 확실히 한 후 리다이렉트
        req.session.save((err) => {
            if (err) {
                console.error('❌ 세션 저장 오류:', err);
                return res.redirect('/login?error=session_save');
            }
            
            // 세션 저장 후 즉시 확인
            console.log(`✅ 로그인 성공: ${req.user.name} (${req.user.email})`);
            console.log(`📱 세션 저장 완료`);
            console.log(`🔧 저장된 세션 확인:`, req.session.passport);
            console.log(`🔧 isAuthenticated 재확인:`, req.isAuthenticated());
            
            // 세션 재로드 후 리다이렉트 (안전성 강화)
            req.session.reload((reloadErr) => {
                if (reloadErr) {
                    console.error('❌ 세션 재로드 오류:', reloadErr);
                    // 재로드 실패해도 리다이렉트는 진행
                }
                
                console.log(`🔄 세션 재로드 후 상태:`, req.isAuthenticated());
                console.log(`🔄 세션 재로드 후 데이터:`, req.session.passport);
                
                try {
                    // 캐시 방지를 위한 타임스탬프 추가
                    const timestamp = Date.now();
                    console.log(`🚀 /planner로 리다이렉트 시작 (t=${timestamp})`);
                    res.redirect(`/planner?t=${timestamp}`);
                } catch (redirectError) {
                    console.error('❌ 리디렉션 오류:', redirectError);
                    res.redirect('/login?error=redirect_failed');
                }
            });
        });
    }
);

// 로그아웃
app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) { return next(err); }
        // 세션 완전히 삭제
        req.session.destroy((destroyErr) => {
            if (destroyErr) {
                console.error('세션 삭제 오류:', destroyErr);
            }
            // 쿠키도 클리어
            res.clearCookie('vacation_planner_session');
            res.redirect('/login');
        });
    });
});

// AI 스케줄 평가 API 엔드포인트
app.post('/evaluate-schedule', async (req, res) => {
    try {
        const { schedules, vacationPeriod } = req.body;

        if (!schedules || !vacationPeriod) {
            return res.status(400).json({ error: '스케줄과 방학 기간 정보가 필요합니다.' });
        }
        
        // 여기에 AI에게 보낼 프롬프트를 작성하고, 스케줄 데이터를 분석합니다.
        const prompt = `
            당신은 학생의 방학 계획을 분석하고 조언해주는 'AI 방학 라이프 플래너'입니다.
            다음은 학생의 방학 기간과 등록된 스케줄 데이터입니다.

            - 방학 기간: ${vacationPeriod.start} ~ ${vacationPeriod.end}
            - 스케줄 목록 (JSON): ${JSON.stringify(schedules, null, 2)}

            **당신의 임무:**
            1.  **데이터 분석:** '자습(study)' 카테고리의 시간을 '순공시간'으로 계산합니다. '완수(completed)'된 것은 계획대로, '미완수(incompleted)'된 것은 실제 기록된 시간으로 계산하고, '예정(pending)'인 것은 계획 시간으로 간주하여 총 예상 순공시간을 계산해주세요.
            2.  **종합 평가:** 계산된 순공시간, 전체적인 스케줄의 균형(자습, 학원, 놀기, 기타의 비율), 규칙성 등을 바탕으로 학생의 방학 계획에 대한 긍정적인 종합 평가를 1~2문장으로 작성해주세요.
            3.  **구체적인 조언:** 평가를 바탕으로, 더 알찬 방학을 보내기 위한 구체적이고 실용적인 조언을 2~3가지 제안해주세요. 
            4.  **응원 메시지:** 마지막으로 학생을 격려하는 힘이 나는 응원 메시지를 1문장 추가해주세요.

            **출력 형식 (반드시 JSON 형식으로 응답해주세요):**
            {
              "evaluation": "종합 평가 내용",
              "suggestions": [
                "조언 1",
                "조언 2",
                "조언 3"
              ],
              "cheeringMessage": "응원 메시지"
            }
        `;

        const result = await model.generateContent(prompt);
        const responseText = await result.response.text();
        
        // Gemini 응답이 JSON 형식이 아닐 경우를 대비한 예외 처리
        const jsonResponse = JSON.parse(responseText.replace(/```json/g, '').replace(/```/g, '').trim());

        res.json(jsonResponse);

    } catch (error) {
        console.error('AI 평가 중 오류 발생:', error);
        res.status(500).json({ error: 'AI 평가 중 서버에서 오류가 발생했습니다.' });
    }
});

// MBTI 기반 학습 코칭 API 엔드포인트
app.post('/mbti-coaching', async (req, res) => {
    try {
        const { mbtiType, studyData, currentSchedule } = req.body;

        if (!mbtiType) {
            return res.status(400).json({ error: 'MBTI 타입이 필요합니다.' });
        }

        const prompt = `
            당신은 MBTI 기반 학습 코칭 전문가입니다. 
            학생의 MBTI 타입: ${mbtiType}
            현재 학습 데이터: ${JSON.stringify(studyData, null, 2)}
            현재 스케줄: ${JSON.stringify(currentSchedule, null, 2)}

            **분석 요청:**
            1. 해당 MBTI 타입의 학습 특성과 강점을 분석해주세요.
            2. 현재 학습 패턴을 바탕으로 개인화된 학습 전략을 제안해주세요.
            3. MBTI 타입에 맞는 구체적인 학습 방법과 시간 관리 팁을 제공해주세요.
            4. 동기부여와 집중력 향상을 위한 맞춤형 조언을 해주세요.

            **출력 형식 (반드시 JSON 형식으로 응답해주세요):**
            {
              "mbtiAnalysis": "MBTI 타입 분석 및 학습 특성",
              "personalizedStrategy": "개인화된 학습 전략",
              "studyTips": [
                "구체적인 학습 팁 1",
                "구체적인 학습 팁 2",
                "구체적인 학습 팁 3"
              ],
              "motivationAdvice": "동기부여 및 집중력 향상 조언"
            }
        `;

        const result = await model.generateContent(prompt);
        const responseText = await result.response.text();
        
        // JSON 응답 파싱 시도
        let jsonResponse;
        try {
            // JSON 마크다운 제거 후 파싱 시도
            const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            jsonResponse = JSON.parse(cleanedText);
        } catch (parseError) {
            console.log('JSON 파싱 실패, 기본 응답 사용:', parseError.message);
            // JSON 파싱 실패 시 기본 응답 생성
            jsonResponse = {
                title: `${mbtiType} 맞춤 학습 코칭`,
                description: responseText,
                studyTips: [
                    "자신의 성격 유형에 맞는 학습 방법을 찾아보세요",
                    "규칙적인 학습 스케줄을 유지하세요",
                    "적절한 휴식과 보상 시스템을 활용하세요"
                ],
                motivationAdvice: "꾸준한 노력이 성공의 열쇠입니다!"
            };
        }

        res.json(jsonResponse);

    } catch (error) {
        console.error('MBTI 코칭 중 오류 발생:', error);
        res.status(500).json({ error: 'MBTI 코칭 중 서버에서 오류가 발생했습니다.' });
    }
});

app.listen(port, () => {
    console.log(`✨ 서버가 시작되었습니다. http://localhost:${port} 에서 확인하세요.`);
});