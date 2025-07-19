require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
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

// 미들웨어 설정
app.use(cookieParser()); // 쿠키 파서 추가

// Redis 세션 저장소 설정 (Vercel 서버리스에서 세션 유지)
let sessionStore;
if (process.env.UPSTASH_REDIS_REST_URL) {
    console.log('🔧 Redis 세션 저장소 설정 중...');
    const RedisStore = require('connect-redis').default;
    const { createClient } = require('redis');
    
    const redisClient = createClient({
        url: process.env.UPSTASH_REDIS_REST_URL,
        password: process.env.UPSTASH_REDIS_REST_TOKEN
    });
    
    redisClient.connect().catch(console.error);
    redisClient.on('error', (err) => console.log('Redis Client Error', err));
    redisClient.on('connect', () => console.log('✅ Redis 연결 성공'));
    
    sessionStore = new RedisStore({
        client: redisClient,
        prefix: "session:",
    });
    console.log('✅ Redis 세션 저장소 설정 완료');
} else {
    console.log('⚠️ Redis URL 없음 - 메모리 세션 사용');
    sessionStore = undefined;
}

// 세션 설정 - Redis 저장소 + OAuth 친화적 설정
app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'your-secret-key-here',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { 
        secure: process.env.VERCEL ? true : false,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
        sameSite: process.env.VERCEL ? 'none' : 'lax',
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

// favicon 제공
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'logo.ico'));
});

// logo.ico 파일 제공
app.get('/logo.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'logo.ico'));
});

// JWT 인증 미들웨어 (세션 대체용)
function authenticateJWT(req, res, next) {
    const token = req.cookies.auth_token;
    
    if (token) {
        const jwt = require('jsonwebtoken');
        try {
            const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'your-secret-key-here');
            req.user = decoded;
            console.log(`🎫 JWT 인증 성공: ${decoded.email}`);
            return next();
        } catch (err) {
            console.log(`❌ JWT 인증 실패:`, err.message);
        }
    }
    
    // JWT 실패 시 세션 기반 인증 시도
    const isAuth = req.isAuthenticated();
    if (isAuth && req.user) {
        console.log(`✅ 세션 인증 성공: ${req.user.email}`);
        return next();
    }
    
    return null; // 인증 실패
}

// 인증 미들웨어 (JWT + 세션 이중 체크)
function requireAuth(req, res, next) {
    try {
        const isAuth = req.isAuthenticated();
        const userEmail = req.user ? req.user.email : null;
        const hasSession = !!req.session;
        const hasPassportData = !!(req.session && req.session.passport);
        const hasJWT = !!(req.cookies && req.cookies.auth_token);
        
        console.log(`🛡️ 인증 미들웨어 체크:`);
        console.log(`  - 요청 URL: ${req.url}`);
        console.log(`  - 세션 ID: ${req.sessionID}`);
        console.log(`  - 세션 존재: ${hasSession}`);
        console.log(`  - Passport 데이터: ${hasPassportData}`);
        console.log(`  - JWT 토큰: ${hasJWT}`);
        console.log(`  - 인증 상태: ${isAuth}`);
        console.log(`  - 사용자: ${userEmail}`);
        console.log(`  - Cookies 객체 존재: ${!!req.cookies}`);
        
        // JWT 인증 시도
        if (hasJWT) {
            const jwt = require('jsonwebtoken');
            try {
                const decoded = jwt.verify(req.cookies.auth_token, process.env.SESSION_SECRET || 'your-secret-key-here');
                req.user = decoded;
                console.log(`✅ JWT 인증 통과 - ${decoded.email}`);
                console.log(`🔍 req.user 설정됨:`, { email: decoded.email, id: decoded.id });
                return next();
            } catch (err) {
                console.log(`❌ JWT 인증 실패:`, err.message);
            }
        }
        
        // 세션 인증 시도
        if (isAuth && req.user) {
            console.log(`✅ 세션 인증 통과 - ${userEmail}`);
            return next();
        }
        
        console.log(`❌ 인증 실패 - /login으로 리다이렉트`);
        console.log(`  - 실패 이유: isAuth=${isAuth}, hasUser=${!!req.user}, hasJWT=${hasJWT}`);
        res.redirect('/login');
        
    } catch (error) {
        console.error(`❌ requireAuth 미들웨어 에러:`, error);
        res.status(500).send(`
            <html>
                <head><title>인증 오류</title></head>
                <body>
                    <h1>인증 처리 중 오류가 발생했습니다</h1>
                    <p>오류 메시지: ${error.message}</p>
                    <a href="/login">로그인 페이지로 이동</a>
                </body>
            </html>
        `);
    }
}

// 라우팅
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/planner', requireAuth, (req, res) => {
    try {
        console.log(`📄 /planner 페이지 접근 - 사용자: ${req.user ? req.user.email : '없음'}`);
        console.log(`🔐 인증 상태: ${req.isAuthenticated()}`);
        console.log(`📁 파일 경로: ${path.join(__dirname, 'planner.html')}`);
        
        const fs = require('fs');
        const filePath = path.join(__dirname, 'planner.html');
        
        // 파일 존재 여부 확인
        if (!fs.existsSync(filePath)) {
            console.error(`❌ planner.html 파일을 찾을 수 없음: ${filePath}`);
            return res.status(404).send('플래너 페이지를 찾을 수 없습니다.');
        }
        
        console.log(`✅ planner.html 파일 발견, 전송 시작`);
        res.sendFile(filePath);
        
    } catch (error) {
        console.error(`❌ /planner 라우트 에러:`, error);
        res.status(500).send(`
            <html>
                <head><title>서버 오류</title></head>
                <body>
                    <h1>서버 오류가 발생했습니다</h1>
                    <p>오류 메시지: ${error.message}</p>
                    <pre>${error.stack}</pre>
                </body>
            </html>
        `);
    }
});

// 세션 체크 API (JWT + 세션 이중 지원)
app.get('/check-session', (req, res) => {
    const isAuth = req.isAuthenticated();
    const sessionID = req.sessionID;
    const hasSession = !!req.session;
    const hasPassportData = !!(req.session && req.session.passport);
    const hasJWT = !!req.cookies.auth_token;
    
    console.log(`🔍 세션 체크 요청:`);
    console.log(`  - 세션 ID: ${sessionID}`);
    console.log(`  - 세션 존재: ${hasSession}`);
    console.log(`  - Passport 데이터 존재: ${hasPassportData}`);
    console.log(`  - JWT 토큰 존재: ${hasJWT}`);
    console.log(`  - 기본 인증 상태: ${isAuth}`);
    
    // JWT 인증 시도
    let authenticatedUser = null;
    if (hasJWT) {
        const jwt = require('jsonwebtoken');
        try {
            const decoded = jwt.verify(req.cookies.auth_token, process.env.SESSION_SECRET || 'your-secret-key-here');
            authenticatedUser = decoded;
            console.log(`🎫 JWT 인증 성공: ${decoded.email}`);
        } catch (err) {
            console.log(`❌ JWT 인증 실패:`, err.message);
        }
    }
    
    // 세션 인증 확인
    if (!authenticatedUser && isAuth && req.user) {
        authenticatedUser = req.user;
        console.log(`✅ 세션 인증 성공: ${req.user.email}`);
    }
    
    if (authenticatedUser) {
        console.log(`✅ 인증 유효 - 사용자: ${authenticatedUser.email}`);
        res.json({ authenticated: true, user: authenticatedUser.email });
    } else {
        console.log(`❌ 인증 무효 - 로그인 필요`);
        console.log(`  - 실패 이유: isAuth=${isAuth}, hasUser=${!!req.user}, hasJWT=${hasJWT}`);
        res.json({ authenticated: false, user: null });
    }
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
        
        // JWT 토큰 생성 (세션 대신 쿠키로 사용자 정보 저장)
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { 
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                picture: req.user.picture
            },
            process.env.SESSION_SECRET || 'your-secret-key-here',
            { expiresIn: '7d' }
        );
        
        console.log(`🎫 JWT 토큰 생성: ${req.user.email}`);
        
        // JWT를 httpOnly 쿠키로 설정
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.VERCEL ? true : false,
            sameSite: process.env.VERCEL ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
        });
        
        // 명시적으로 세션에도 사용자 정보 저장 (이중 보장)
        console.log(`🔧 수동 세션 설정 전:`, req.session.passport);
        req.session.passport = req.session.passport || {};
        req.session.passport.user = req.user;
        console.log(`🔧 수동 세션 설정 후:`, req.session.passport);
        console.log(`🔧 isAuthenticated 상태:`, req.isAuthenticated());
        
        // 세션 저장을 확실히 한 후 리다이렉트
        req.session.save((err) => {
            if (err) {
                console.error('❌ 세션 저장 오류:', err);
                // JWT가 있으므로 세션 실패해도 계속 진행
            }
            
            console.log(`✅ 로그인 성공: ${req.user.name} (${req.user.email})`);
            console.log(`📱 세션 및 JWT 설정 완료`);
            
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
            // 쿠키도 클리어 (세션 + JWT)
            res.clearCookie('vacation_planner_session');
            res.clearCookie('auth_token');
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

// 📤 공유 기능 API
// 공유 링크 상태 확인
app.get('/api/share/status', requireAuth, async (req, res) => {
    try {
        console.log('🔍 공유 상태 확인 API 시작');
        console.log('🔍 req.user:', req.user);
        console.log('🔍 req.session?.user:', req.session?.user);
        
        // JWT 인증과 세션 인증 모두 지원
        const userEmail = req.user?.email || req.session?.user?.email;
        
        console.log('🔍 추출된 userEmail:', userEmail);
        
        if (!userEmail) {
            console.log('❌ 사용자 이메일을 찾을 수 없음');
            return res.status(401).json({ error: '인증되지 않은 사용자' });
        }
        
        // 기존 공유 토큰 확인
        const viewToken = await kv.get(`share:view:${userEmail}`);
        const recordToken = await kv.get(`share:record:${userEmail}`);
        
        if (viewToken && recordToken) {
            res.json({
                hasActiveLinks: true,
                viewToken,
                recordToken
            });
        } else {
            res.json({
                hasActiveLinks: false
            });
        }
        
    } catch (error) {
        console.error('공유 상태 확인 오류:', error);
        res.status(500).json({ error: '공유 상태 확인 중 오류가 발생했습니다.' });
    }
});

// 클라이언트 데이터 기반 공유 링크 생성 (인증 불필요)
app.post('/api/share/create', async (req, res) => {
    try {
        console.log('📤 클라이언트 기반 공유 링크 생성 시작');
        
        const { vacationPeriod, schedules, studyRecords, completedSchedules, createdAt } = req.body;
        
        // 데이터 검증
        if (!vacationPeriod || !vacationPeriod.start || !vacationPeriod.end) {
            return res.status(400).json({ 
                success: false, 
                error: '방학 기간 정보가 필요합니다' 
            });
        }
        
        // 고유 토큰 생성
        const viewToken = generateToken();
        const recordToken = generateToken();
        
        const shareData = {
            vacationPeriod,
            schedules: schedules || [],
            studyRecords: studyRecords || {},
            completedSchedules: completedSchedules || {},
            createdAt: createdAt || new Date().toISOString(),
            viewToken,
            recordToken
        };
        
        // KV에 저장
        await kv.set(`share:view:${viewToken}`, JSON.stringify(shareData));
        await kv.set(`share:record:${recordToken}`, JSON.stringify(shareData));
        
        console.log('✅ 공유 데이터 저장 완료:', {
            viewToken: viewToken.substring(0, 8) + '...',
            recordToken: recordToken.substring(0, 8) + '...',
            dataSize: JSON.stringify(shareData).length
        });
        
        res.json({
            success: true,
            viewToken,
            recordToken,
            message: '공유 링크가 생성되었습니다'
        });
        
    } catch (error) {
        console.error('공유 링크 생성 오류:', error);
        res.status(500).json({ 
            success: false, 
            error: '서버 오류가 발생했습니다' 
        });
    }
});

// 공유 링크 생성 (기존 - 인증 필요)
app.post('/api/share/generate', requireAuth, async (req, res) => {
    try {
        // JWT 인증과 세션 인증 모두 지원
        const userEmail = req.user?.email || req.session?.user?.email;
        
        if (!userEmail) {
            console.log('❌ 사용자 이메일을 찾을 수 없음');
            return res.status(401).json({ error: '인증되지 않은 사용자' });
        }
        
        // 랜덤 토큰 생성
        const viewToken = generateShareToken();
        const recordToken = generateShareToken();
        
        // 토큰 저장 (30일 만료)
        const expirationTime = 30 * 24 * 60 * 60; // 30일
        
        await Promise.all([
            // 사용자별 토큰 저장
            kv.set(`share:view:${userEmail}`, viewToken, { ex: expirationTime }),
            kv.set(`share:record:${userEmail}`, recordToken, { ex: expirationTime }),
            
            // 토큰별 사용자 정보 저장
            kv.set(`token:view:${viewToken}`, userEmail, { ex: expirationTime }),
            kv.set(`token:record:${recordToken}`, userEmail, { ex: expirationTime })
        ]);
        
        res.json({
            success: true,
            viewToken,
            recordToken
        });
        
    } catch (error) {
        console.error('공유 링크 생성 오류:', error);
        res.status(500).json({ error: '공유 링크 생성 중 오류가 발생했습니다.' });
    }
});

// 공유 링크 취소
app.post('/api/share/revoke', requireAuth, async (req, res) => {
    try {
        // JWT 인증과 세션 인증 모두 지원
        const userEmail = req.user?.email || req.session?.user?.email;
        
        if (!userEmail) {
            console.log('❌ 사용자 이메일을 찾을 수 없음');
            return res.status(401).json({ error: '인증되지 않은 사용자' });
        }
        
        // 기존 토큰 조회
        const viewToken = await kv.get(`share:view:${userEmail}`);
        const recordToken = await kv.get(`share:record:${userEmail}`);
        
        // 모든 관련 키 삭제
        const deletePromises = [
            kv.del(`share:view:${userEmail}`),
            kv.del(`share:record:${userEmail}`)
        ];
        
        if (viewToken) {
            deletePromises.push(kv.del(`token:view:${viewToken}`));
        }
        if (recordToken) {
            deletePromises.push(kv.del(`token:record:${recordToken}`));
        }
        
        await Promise.all(deletePromises);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('공유 링크 취소 오류:', error);
        res.status(500).json({ error: '공유 링크 취소 중 오류가 발생했습니다.' });
    }
});

// 공유된 캘린더 보기 (읽기 전용)
app.get('/shared/view/:token', async (req, res) => {
    try {
        const { token } = req.params;
        
        // 토큰으로 사용자 확인
        const userEmail = await kv.get(`token:view:${token}`);
        if (!userEmail) {
            return res.status(404).send(`
                <html>
                    <head><title>유효하지 않은 링크</title></head>
                    <body style="font-family: Arial; text-align: center; padding: 50px;">
                        <h2>⚠️ 유효하지 않은 공유 링크입니다</h2>
                        <p>링크가 만료되었거나 삭제되었을 수 있습니다.</p>
                    </body>
                </html>
            `);
        }
        
        // 공유용 HTML 페이지 반환
        res.send(generateSharedCalendarHTML(userEmail, token, 'view'));
        
    } catch (error) {
        console.error('공유 캘린더 조회 오류:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 공유된 캘린더 보기 (실적 입력 가능)
app.get('/shared/record/:token', async (req, res) => {
    try {
        const { token } = req.params;
        
        // 토큰으로 사용자 확인
        const userEmail = await kv.get(`token:record:${token}`);
        if (!userEmail) {
            return res.status(404).send(`
                <html>
                    <head><title>유효하지 않은 링크</title></head>
                    <body style="font-family: Arial; text-align: center; padding: 50px;">
                        <h2>⚠️ 유효하지 않은 공유 링크입니다</h2>
                        <p>링크가 만료되었거나 삭제되었을 수 있습니다.</p>
                    </body>
                </html>
            `);
        }
        
        // 공유용 HTML 페이지 반환
        res.send(generateSharedCalendarHTML(userEmail, token, 'record'));
        
    } catch (error) {
        console.error('공유 캘린더 조회 오류:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 공유된 캘린더 데이터 API
app.get('/api/shared/:token/data', async (req, res) => {
    try {
        const { token } = req.params;
        
        // 토큰 유효성 확인
        const viewUserEmail = await kv.get(`token:view:${token}`);
        const recordUserEmail = await kv.get(`token:record:${token}`);
        const userEmail = viewUserEmail || recordUserEmail;
        
        if (!userEmail) {
            return res.status(404).json({ error: '유효하지 않은 토큰입니다.' });
        }
        
        // 사용자 데이터 조회
        const [schedules, studyRecords, completedSchedules, vacationPeriod] = await Promise.all([
            kv.get(`user:${userEmail}:schedules`) || [],
            kv.get(`user:${userEmail}:studyRecords`) || {},
            kv.get(`user:${userEmail}:completedSchedules`) || {},
            kv.get(`user:${userEmail}:vacationPeriod`) || null
        ]);
        
        // 권한 정보 추가
        const canRecord = !!recordUserEmail;
        
        res.json({
            schedules,
            studyRecords,
            completedSchedules,
            vacationPeriod,
            permissions: {
                canRecord,
                ownerEmail: userEmail
            }
        });
        
    } catch (error) {
        console.error('공유 캘린더 데이터 조회 오류:', error);
        res.status(500).json({ error: '데이터 조회 중 오류가 발생했습니다.' });
    }
});

// 공유된 캘린더에서 실적 입력 (record 권한만)
app.post('/api/shared/:token/study-record', async (req, res) => {
    try {
        const { token } = req.params;
        
        // record 토큰 확인
        const userEmail = await kv.get(`token:record:${token}`);
        if (!userEmail) {
            return res.status(403).json({ error: '실적 입력 권한이 없습니다.' });
        }
        
        const { dateKey, slotId, minutes, subject, notes } = req.body;
        
        // 기존 실적 데이터 조회
        const studyRecords = await kv.get(`user:${userEmail}:studyRecords`) || {};
        
        // 새 실적 추가/업데이트
        if (!studyRecords[dateKey]) {
            studyRecords[dateKey] = {};
        }
        
        studyRecords[dateKey][slotId] = {
            minutes: parseInt(minutes) || 0,
            subject: subject || '',
            notes: notes || '',
            timestamp: new Date().toISOString()
        };
        
        // 저장
        await kv.set(`user:${userEmail}:studyRecords`, studyRecords);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('공유 캘린더 실적 입력 오류:', error);
        res.status(500).json({ error: '실적 입력 중 오류가 발생했습니다.' });
    }
});

// 공유 토큰 생성 함수
function generateShareToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

// 공유용 HTML 생성 함수
function generateSharedCalendarHTML(userEmail, token, permission) {
    const permissionText = permission === 'view' ? '읽기 전용' : '실적 입력 가능';
    const canRecord = permission === 'record';
    
    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🏖️ 방학 순공 플래너 - 공유 캘린더</title>
    <link rel="stylesheet" href="/css/planner_style.css">
    <style>
        .shared-header {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 12px;
            text-align: center;
        }
        .shared-info {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #667eea;
        }
        .permission-badge {
            display: inline-block;
            background: ${canRecord ? '#10b981' : '#6366f1'};
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            margin-left: 8px;
        }
        .readonly-notice {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="shared-header">
            <h1>🏖️ 방학 순공 플래너</h1>
            <p>공유된 캘린더 <span class="permission-badge">${permissionText}</span></p>
        </div>
        
        <div class="shared-info">
            <p><strong>📌 이 캘린더는 공유 링크로 접근하고 있습니다.</strong></p>
            ${canRecord ? 
                '<p>✅ 캘린더 보기 + 순공 시간 실적 입력이 가능합니다.</p>' : 
                '<p>👀 캘린더와 통계만 확인할 수 있습니다.</p>'
            }
        </div>
        
        ${!canRecord ? '<div class="readonly-notice">📖 읽기 전용 모드입니다. 실적 입력 및 일정 수정은 불가능합니다.</div>' : ''}
        
        <!-- 캘린더 영역 -->
        <div class="my-schedule-section">
            <div class="section-header">
                <h2>📚 방학 계획표</h2>
            </div>
            
            <div id="calendar-container">
                <div id="calendar"></div>
            </div>
        </div>
        
        <!-- 이번주 주요일정 -->
        <div class="weekly-schedule-section">
            <h2>📅 이번주 주요일정</h2>
            <div id="weekly-schedule"></div>
        </div>
        
        <!-- 주간 평가 -->
        <div class="weekly-evaluation-section">
            <h2>📊 학습 진도 평가</h2>
            <div class="evaluation-box" id="evaluation-box">
                <p>데이터를 불러오는 중...</p>
            </div>
        </div>
    </div>
    
    <!-- 모달들 -->
    <div id="day-summary-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="day-summary-title">날짜 요약</h2>
                <span class="close-button" id="day-modal-close">&times;</span>
            </div>
            <div class="modal-body">
                <div id="day-summary-content"></div>
            </div>
        </div>
    </div>
    
    ${canRecord ? `
    <div id="study-time-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>⏱️ 순공 시간 입력</h2>
                <span class="close-button" id="study-modal-close">&times;</span>
            </div>
            <div class="modal-body">
                <div id="study-time-content"></div>
            </div>
        </div>
    </div>
    ` : ''}
    
    <div id="toast-container"></div>
    
    <script>
        // 공유 모드 설정
        window.SHARED_MODE = {
            isShared: true,
            token: '${token}',
            canRecord: ${canRecord},
            userEmail: '${userEmail}'
        };
    </script>
    <script src="/js/shared_planner.js"></script>
</body>
</html>
    `;
}

app.listen(port, () => {
    console.log(`✨ 서버가 시작되었습니다. http://localhost:${port} 에서 확인하세요.`);
});