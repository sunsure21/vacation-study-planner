require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const nodemailer = require('nodemailer');
const { saveUserData, getUserData, getAllUserData, deleteUserData, memoryStore } = require('./lib/kv');

const app = express();
const port = 3001;

// Vercel 환경에서 프록시 신뢰 설정
if (process.env.VERCEL) {
    app.set('trust proxy', 1);
}

// 미들웨어 설정
app.use(cookieParser());

// 📋 모든 요청 로깅
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url} - ${new Date().toISOString()}`);
    console.log('📋 요청 헤더:', req.headers);
    next();
}); // 쿠키 파서 추가

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

// 세션 설정 - 단순화된 설정
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

// Google OAuth 전략 설정 - 2024 정책 호환
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'your_google_client_id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'your_google_client_secret',
    callbackURL: process.env.VERCEL ? "https://vacation-study-planner.vercel.app/auth/google/callback" : "/auth/google/callback",
    // Google OAuth 2024 정책 호환 설정
    passReqToCallback: false
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

// 파비콘 완전 제거 - 강제 404 및 캐시 방지
app.get('/favicon.ico', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(404).end();
});

// 로고 파일도 완전 제거
app.get('/logo.ico', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(404).end();
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



// 로그인 페이지 - 단순화 (OAuth 먼저 시도)
app.get('/login', (req, res) => {
    const oauthError = req.query.error;
    
    // OAuth 실패 시에만 Gmail 로그인 페이지
    if (oauthError === 'oauth_failed') {
        console.log('📱 OAuth 실패 - Gmail 로그인 페이지 제공');
        res.sendFile(path.join(__dirname, 'public', 'mobile_login.html'));
    } else {
        // 기본: 모든 사용자에게 Google OAuth 시도
        res.sendFile(path.join(__dirname, 'login.html'));
    }
});

// 안드로이드 브라우저용 대체 로그인 (Gmail만 허용)
app.post('/auth/mobile-gmail', express.json(), (req, res) => {
    const { email } = req.body;
    
    // Gmail 주소만 허용
    if (!email || !email.endsWith('@gmail.com')) {
        return res.status(403).json({ error: 'Gmail 주소만 사용할 수 있습니다.' });
    }
    
    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@gmail\.com$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: '올바른 Gmail 주소를 입력해주세요.' });
    }
    
    // 사용자 객체 생성 (Google OAuth와 동일한 구조)
    const user = {
        id: 'gmail_' + email.split('@')[0],
        email: email,
        name: email.split('@')[0],
        picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(email.split('@')[0])}&background=4285f4&color=fff`
    };
    
    // JWT 토큰 생성
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(user, process.env.SESSION_SECRET || 'your-secret-key-here', { expiresIn: '7d' });
    
    // JWT를 쿠키로 설정
    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.VERCEL ? true : false,
        sameSite: process.env.VERCEL ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    console.log(`📱 Gmail 대체 로그인: ${email}`);
    res.json({ success: true, message: '로그인 성공' });
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

// Google OAuth 라우트 - 인앱 브라우저 차단
app.get('/auth/google', (req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';
    
    // 인앱 브라우저 감지
    const isKakaoTalk = /KAKAOTALK/i.test(userAgent);
    const isNaverApp = /NAVER\(inapp/i.test(userAgent);
    const isLineApp = /Line/i.test(userAgent);
    const isFacebookApp = /FBAN|FBAV/i.test(userAgent);
    const isInstagramApp = /Instagram/i.test(userAgent);
    const isWechatApp = /MicroMessenger/i.test(userAgent);
    
    const isInAppBrowser = isKakaoTalk || isNaverApp || isLineApp || 
                          isFacebookApp || isInstagramApp || isWechatApp;
    
    console.log('🔐 OAuth 요청:', {
        userAgent: userAgent.substring(0, 100),
        isInAppBrowser,
        isKakaoTalk,
        isNaverApp
    });
    
    // 인앱 브라우저에서 접근 시 안내 페이지로 리다이렉트
    if (isInAppBrowser) {
        return res.redirect('/login?error=inapp_browser');
    }
    
    passport.authenticate('google', { 
        scope: ['profile', 'email']
    })(req, res, next);
});

app.get('/auth/google/callback', 
    passport.authenticate('google', { 
        failureRedirect: '/login?error=oauth_failed',
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
        const cookieOptions = {
            httpOnly: true,
            secure: process.env.VERCEL ? true : false,
            sameSite: process.env.VERCEL ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
        };
        
        console.log('🍪 쿠키 설정:', cookieOptions);
        res.cookie('auth_token', token, cookieOptions);
        console.log('🍪 JWT 쿠키 설정 완료');
        
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

// 토큰 생성 함수
function generateToken() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// 클라이언트 데이터 기반 공유 링크 생성 (인증 필요)
app.post('/api/share/create', requireAuth, async (req, res) => {
    try {
        console.log('📤 클라이언트 기반 공유 링크 생성 시작');
        console.log('📤 요청 헤더:', req.headers);
        console.log('📤 요청 메소드:', req.method);
        console.log('📤 요청 URL:', req.url);
        
        const { vacationPeriod, schedules, studyRecords, completedSchedules, createdAt } = req.body;
        
        // 데이터 검증 (최소한만)
        console.log('📊 받은 데이터:', { 
            hasVacationPeriod: !!vacationPeriod,
            schedulesCount: schedules ? schedules.length : 0 
        });
        
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
        
        // 실시간 연동: 토큰에 사용자 이메일 연결 (데이터 복사 없음)
        const userEmail = req.user?.email;
        console.log('🔍 공유 링크 생성 - 사용자 이메일:', userEmail);
        
        if (!userEmail) {
            console.log('❌ 사용자 이메일이 없음');
            return res.status(401).json({ error: '인증이 필요합니다.' });
        }
        
        console.log('🔍 환경 변수 체크:', {
            NODE_ENV: process.env.NODE_ENV,
            hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
            hasUpstashToken: !!process.env.UPSTASH_REDIS_REST_TOKEN
        });
        
        // 🔧 개선: Redis 시도 후 실패 시 즉시 KV Store 사용
        let redisSuccess = false;
        
        // Redis 환경 변수가 있는 경우에만 시도
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            try {
                console.log('💾 Redis에 토큰 저장 시도');
                const { Redis } = require('@upstash/redis');
                const kvStore = Redis.fromEnv();
                
                // Redis 연결 테스트 먼저 실행
                await kvStore.ping();
                console.log('🔗 Redis 연결 테스트 성공');
                
                // 토큰 저장 (만료 없이 영구 저장)
                await kvStore.set(`token:view:${viewToken}`, userEmail);
                await kvStore.set(`token:record:${recordToken}`, userEmail);
                
                console.log('✅ Redis에 토큰 저장 완료');
                redisSuccess = true;
            } catch (error) {
                console.log('⚠️ Redis 저장 실패:', error.message);
            }
        } else {
            console.log('⚠️ Redis 환경 변수 없음 - KV Store 직접 사용');
        }
        
        // Redis 실패 시 KV Store를 메인 저장소로 사용
        let kvSuccess = false;
        if (!redisSuccess) {
            console.log('📝 KV Store를 메인 저장소로 사용');
            
            try {
                // 🔧 개별 토큰을 별도 키로 저장 (조회 최적화)
                const viewTokenKey = `shareToken_view_${viewToken}`;
                const recordTokenKey = `shareToken_record_${recordToken}`;
                
                const viewResult = await saveUserData('system', viewTokenKey, {
                    userEmail: userEmail,
                    token: viewToken,
                    type: 'view',
                    createdAt: new Date().toISOString()
                });
                
                const recordResult = await saveUserData('system', recordTokenKey, {
                    userEmail: userEmail,
                    token: recordToken,
                    type: 'record',
                    createdAt: new Date().toISOString()
                });
                
                if (viewResult.success && recordResult.success) {
                    console.log('✅ KV Store에 토큰 저장 완료');
                    console.log(`📋 저장된 토큰: view=${viewTokenKey}, record=${recordTokenKey}`);
                    kvSuccess = true;
                }
            } catch (kvError) {
                console.log('⚠️ KV Store 저장 실패:', kvError.message);
            }
            
            if (!kvSuccess) {
                console.log('📝 메모리 저장소에 토큰 저장 (최후 수단)');
                memoryStore.set(`token:view:${viewToken}`, userEmail);
                memoryStore.set(`token:record:${recordToken}`, userEmail);
                console.log('✅ 메모리 저장소 토큰 저장 완료');
                console.log('📋 저장된 토큰 확인:', {
                    view: memoryStore.get(`token:view:${viewToken}`),
                    record: memoryStore.get(`token:record:${recordToken}`)
                });
                console.log('⚠️ 주의: 메모리 저장소는 서버 재시작 시 초기화됩니다');
            }
        }
        
        // 🔧 중요: 토큰 저장 상태 최종 검증
        const tokenValidation = {
            redis: redisSuccess,
            kvStore: kvSuccess,
            memory: {
                view: memoryStore.get(`token:view:${viewToken}`) ? true : false,
                record: memoryStore.get(`token:record:${recordToken}`) ? true : false
            }
        };
        
        console.log('🔍 토큰 저장 상태 최종 검증:', tokenValidation);
        
        // Redis, KV Store, 메모리 중 적어도 하나는 성공해야 함
        if (!redisSuccess && !kvSuccess && (!tokenValidation.memory.view || !tokenValidation.memory.record)) {
            console.error('❌ 치명적 오류: 토큰 저장 완전 실패');
            return res.status(500).json({
                success: false,
                error: '토큰 저장에 실패했습니다. 다시 시도해주세요.'
            });
        }
        
        console.log('✅ 공유 데이터 저장 완료:', {
            viewToken: viewToken.substring(0, 8) + '...',
            recordToken: recordToken.substring(0, 8) + '...',
            dataSize: JSON.stringify(shareData).length,
            redisSuccess,
            memoryBackup: !redisSuccess
        });
        
        const storageMethod = redisSuccess ? 'Redis 저장' : 
                             kvSuccess ? 'KV Store 저장' : 
                             '메모리 저장 (임시)';
        
        res.json({
            success: true,
            viewToken,
            recordToken,
            message: '공유 링크가 생성되었습니다',
            storageInfo: storageMethod
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

// 공유된 캘린더 보기 (읽기 전용) - 실시간 연동
app.get('/shared/view/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🔍 공유 링크 접근 시도 - view 토큰:', token);
        
        // 실시간 연동: 토큰 검증 후 HTML 반환
        let userEmail = null;
        
        console.log('🔍 토큰 조회 환경 체크:', {
            NODE_ENV: process.env.NODE_ENV,
            hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
            isProduction: process.env.NODE_ENV === 'production'
        });
        
        // 🔧 개선: Redis → KV Store → 메모리 순으로 토큰 조회
        
        // 1. Redis 먼저 시도 (환경 변수가 있는 경우)
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            try {
                console.log('🔍 Redis에서 토큰 조회 시도');
                const { Redis } = require('@upstash/redis');
                const kvStore = Redis.fromEnv();
                
                await kvStore.ping();
                console.log('🔗 Redis 연결 테스트 성공');
                
                userEmail = await kvStore.get(`token:view:${token}`);
                console.log('📦 Redis 조회 결과:', userEmail ? `사용자: ${userEmail}` : '토큰 없음');
            } catch (error) {
                console.log('⚠️ Redis 조회 실패:', error.message);
            }
        } else {
            console.log('⚠️ Redis 환경 변수 없음 - KV Store 사용');
        }
        
        // 2. Redis 실패 시 KV Store에서 조회
        if (!userEmail) {
            try {
                console.log('🔍 KV Store에서 토큰 조회 시도');
                const viewTokenKey = `shareToken_view_${token}`;
                const tokenData = await getUserData('system', viewTokenKey);
                
                if (tokenData.success && tokenData.data && tokenData.data.userEmail) {
                    userEmail = tokenData.data.userEmail;
                    console.log(`✅ KV Store에서 토큰 발견: ${userEmail}`);
                } else {
                    console.log(`📝 KV Store에서 토큰 없음: ${viewTokenKey}`);
                }
            } catch (kvError) {
                console.log('⚠️ KV Store 조회 실패:', kvError.message);
            }
        }
        
        // 3. 최후 수단: 메모리 저장소 확인
        if (!userEmail) {
            console.log('📝 메모리 저장소에서 토큰 조회');
            userEmail = memoryStore.get(`token:view:${token}`);
            console.log('📦 메모리 저장소 조회 결과:', userEmail ? `사용자: ${userEmail}` : '토큰 없음');
        }
        
        if (!userEmail) {
            console.log('❌ 유효하지 않은 토큰:', token);
            return res.status(404).send('<h1>❌ 유효하지 않은 공유 링크입니다.</h1>');
        }
        
        console.log('✅ 토큰 검증 성공, 공유 캘린더 HTML 생성');
        res.send(generateSharedCalendarHTML(userEmail, token, 'view'));
        
    } catch (error) {
        console.error('공유 캘린더 조회 오류:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 공유된 캘린더 보기 (실적 입력 가능) - 실시간 연동
app.get('/shared/record/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🔍 공유 링크 접근 시도 - record 토큰:', token);
        
        // 실시간 연동: 토큰 검증 후 HTML 반환
        let userEmail = null;
        
        console.log('🔍 토큰 조회 환경 체크:', {
            NODE_ENV: process.env.NODE_ENV,
            hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
            isProduction: process.env.NODE_ENV === 'production'
        });
        
        // 🔧 개선: Redis → KV Store → 메모리 순으로 토큰 조회
        
        // 1. Redis 먼저 시도 (환경 변수가 있는 경우)
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            try {
                console.log('🔍 Redis에서 토큰 조회 시도');
                const { Redis } = require('@upstash/redis');
                const kvStore = Redis.fromEnv();
                
                await kvStore.ping();
                console.log('🔗 Redis 연결 테스트 성공');
                
                userEmail = await kvStore.get(`token:record:${token}`);
                console.log('📦 Redis 조회 결과:', userEmail ? `사용자: ${userEmail}` : '토큰 없음');
            } catch (error) {
                console.log('⚠️ Redis 조회 실패:', error.message);
            }
        } else {
            console.log('⚠️ Redis 환경 변수 없음 - KV Store 사용');
        }
        
        // 2. Redis 실패 시 KV Store에서 조회
        if (!userEmail) {
            try {
                console.log('🔍 KV Store에서 토큰 조회 시도');
                const recordTokenKey = `shareToken_record_${token}`;
                const tokenData = await getUserData('system', recordTokenKey);
                
                if (tokenData.success && tokenData.data && tokenData.data.userEmail) {
                    userEmail = tokenData.data.userEmail;
                    console.log(`✅ KV Store에서 토큰 발견: ${userEmail}`);
                } else {
                    console.log(`📝 KV Store에서 토큰 없음: ${recordTokenKey}`);
                }
            } catch (kvError) {
                console.log('⚠️ KV Store 조회 실패:', kvError.message);
            }
        }
        
        // 3. 최후 수단: 메모리 저장소 확인
        if (!userEmail) {
            console.log('📝 메모리 저장소에서 토큰 조회');
            userEmail = memoryStore.get(`token:record:${token}`);
            console.log('📦 메모리 저장소 조회 결과:', userEmail ? `사용자: ${userEmail}` : '토큰 없음');
        }
        
        if (!userEmail) {
            console.log('❌ 유효하지 않은 토큰:', token);
            return res.status(404).send('<h1>❌ 유효하지 않은 공유 링크입니다.</h1>');
        }
        
        console.log('✅ 토큰 검증 성공, 공유 캘린더 HTML 생성');
        res.send(generateSharedCalendarHTML(userEmail, token, 'record'));
        
    } catch (error) {
        console.error('공유 캘린더 조회 오류:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 공유된 캘린더 데이터 API (실시간 연동)
app.get('/api/shared/:token/data', async (req, res) => {
    try {
        const { token } = req.params;
        
        // 실시간 연동: 토큰에서 사용자 이메일 조회
        let userEmail = null;
        let canRecord = false;
        
        // 🔧 개선: Redis → KV Store → 메모리 순으로 토큰 조회
        let viewUserEmail = null;
        let recordUserEmail = null;
        
        // 1. Redis 먼저 시도 (환경 변수가 있는 경우)
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            try {
                const { Redis } = require('@upstash/redis');
                const kvStore = Redis.fromEnv();
                
                // view 또는 record 토큰으로 사용자 이메일 조회
                viewUserEmail = await kvStore.get(`token:view:${token}`);
                recordUserEmail = await kvStore.get(`token:record:${token}`);
                console.log('📦 Redis 조회 결과:', { viewUserEmail, recordUserEmail });
            } catch (error) {
                console.log('⚠️ Redis 조회 실패:', error.message);
            }
        } else {
            console.log('⚠️ Redis 환경 변수 없음 - KV Store 사용');
        }
        
        // 2. Redis 실패 시 KV Store에서 조회
        if (!viewUserEmail && !recordUserEmail) {
            try {
                console.log('🔍 KV Store에서 토큰 조회 시도');
                const viewTokenKey = `shareToken_view_${token}`;
                const recordTokenKey = `shareToken_record_${token}`;
                
                const viewTokenData = await getUserData('system', viewTokenKey);
                const recordTokenData = await getUserData('system', recordTokenKey);
                
                if (viewTokenData.success && viewTokenData.data && viewTokenData.data.userEmail) {
                    viewUserEmail = viewTokenData.data.userEmail;
                    console.log(`✅ KV Store에서 view 토큰 발견: ${viewUserEmail}`);
                }
                
                if (recordTokenData.success && recordTokenData.data && recordTokenData.data.userEmail) {
                    recordUserEmail = recordTokenData.data.userEmail;
                    console.log(`✅ KV Store에서 record 토큰 발견: ${recordUserEmail}`);
                }
                
                if (!viewUserEmail && !recordUserEmail) {
                    console.log(`📝 KV Store에서 토큰 없음: ${viewTokenKey}, ${recordTokenKey}`);
                }
            } catch (kvError) {
                console.log('⚠️ KV Store 조회 실패:', kvError.message);
            }
        }
        
        // 3. 최후 수단: 메모리 저장소 확인
        if (!viewUserEmail && !recordUserEmail) {
            console.log('📝 메모리 저장소에서 토큰 조회');
            viewUserEmail = memoryStore.get(`token:view:${token}`);
            recordUserEmail = memoryStore.get(`token:record:${token}`);
            console.log('📦 메모리 조회 결과:', { viewUserEmail, recordUserEmail });
        }
        
        userEmail = viewUserEmail || recordUserEmail;
        canRecord = !!recordUserEmail;
        
        if (!userEmail) {
            return res.status(404).json({ error: '유효하지 않은 토큰입니다.' });
        }
        
        // 실시간으로 원본 사용자 데이터 조회 (개별 조회)
        const vacationPeriodResult = await getUserData(userEmail, 'vacationPeriod');
        const schedulesResult = await getUserData(userEmail, 'schedules');
        const studyRecordsResult = await getUserData(userEmail, 'studyRecords');
        const completedSchedulesResult = await getUserData(userEmail, 'completedSchedules');
        
        res.json({
            schedules: schedulesResult.success ? (schedulesResult.data || []) : [],
            studyRecords: studyRecordsResult.success ? (studyRecordsResult.data || {}) : {},
            completedSchedules: completedSchedulesResult.success ? (completedSchedulesResult.data || {}) : {},
            vacationPeriod: vacationPeriodResult.success ? vacationPeriodResult.data : null,
            permissions: {
                canRecord,
                ownerEmail: userEmail,
                isRealTime: true
            }
        });
        
    } catch (error) {
        console.error('공유 캘린더 데이터 조회 오류:', error);
        res.status(500).json({ error: '데이터 조회 중 오류가 발생했습니다.' });
    }
});

// 공유된 캘린더에서 실적 입력 (record 권한만) - 실시간 연동
app.post('/api/shared/:token/study-record', async (req, res) => {
    try {
        const { token } = req.params;
        console.log(`🔍 실적 입력 요청 - 토큰: ${token}`);
        
        // 실시간 연동: record 토큰으로 사용자 이메일 조회
        let userEmail = null;
        
        // 1. Redis 먼저 시도 (환경 변수가 있는 경우)
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            try {
                const { Redis } = require('@upstash/redis');
                const kvStore = Redis.fromEnv();
                console.log(`🔍 Redis에서 토큰 조회: token:record:${token}`);
                userEmail = await kvStore.get(`token:record:${token}`);
                console.log(`📝 Redis 조회 결과:`, userEmail ? `사용자 발견: ${userEmail}` : '토큰 없음');
            } catch (error) {
                console.log('⚠️ Redis 조회 실패:', error.message);
            }
        }
        
        // 2. Redis 실패 시 KV Store에서 조회
        if (!userEmail) {
            try {
                console.log('🔍 KV Store에서 토큰 조회 시도');
                const recordTokenKey = `shareToken_record_${token}`;
                const tokenData = await getUserData('system', recordTokenKey);
                
                if (tokenData.success && tokenData.data && tokenData.data.userEmail) {
                    userEmail = tokenData.data.userEmail;
                    console.log(`✅ KV Store에서 토큰 발견: ${userEmail}`);
                } else {
                    console.log(`📝 KV Store에서 토큰 없음: ${recordTokenKey}`);
                }
            } catch (kvError) {
                console.log('⚠️ KV Store 조회 실패:', kvError.message);
            }
        }
        
        // 3. 최후 수단: 메모리 저장소 확인
        if (!userEmail) {
            console.log(`🔍 메모리에서 토큰 조회: token:record:${token}`);
            userEmail = memoryStore.get(`token:record:${token}`);
            console.log(`📝 메모리 조회 결과:`, userEmail ? `사용자 발견: ${userEmail}` : '토큰 없음');
        }
        
        if (!userEmail) {
            // view 토큰으로 시도했는지 확인
            let isViewToken = false;
            let viewEmail = null;
            try {
                if (process.env.NODE_ENV === 'production' && process.env.UPSTASH_REDIS_REST_URL) {
                    const { Redis } = require('@upstash/redis');
                    const kvStore = Redis.fromEnv();
                    console.log(`🔍 Redis에서 view 토큰 확인: token:view:${token}`);
                    viewEmail = await kvStore.get(`token:view:${token}`);
                    if (viewEmail) {
                        isViewToken = true;
                        console.log(`📖 view 토큰 발견: ${viewEmail}`);
                    }
                } else {
                    console.log(`🔍 메모리에서 view 토큰 확인: token:view:${token}`);
                    viewEmail = memoryStore.get(`token:view:${token}`);
                    if (viewEmail) {
                        isViewToken = true;
                        console.log(`📖 view 토큰 발견: ${viewEmail}`);
                    }
                }
            } catch (error) {
                console.log('토큰 타입 확인 오류:', error);
            }
            
            const errorMessage = isViewToken 
                ? '읽기 전용 링크입니다. 실적 입력 권한이 있는 링크로 접근해주세요.' 
                : '유효하지 않은 토큰이거나 실적 입력 권한이 없습니다.';
            
            console.log(`❌ 토큰 검증 실패: ${errorMessage}`);
            return res.status(403).json({ error: errorMessage });
        }
        
        console.log(`✅ 토큰 검증 성공: ${userEmail}`);
        
        const { dateKey, slotId, minutes, subject, notes, studyRecords, completedSchedules } = req.body;
        
        // 🚀 실시간 연동: 원본 사용자 데이터에 직접 저장
        let saveResults = [];
        
        // 1. 순공 실적 데이터 저장 (기존 방식)
        if (slotId && minutes !== undefined) {
            const studyRecordsResult = await getUserData(userEmail, 'studyRecords');
            const currentStudyRecords = studyRecordsResult.success ? (studyRecordsResult.data || {}) : {};
            
            if (!currentStudyRecords[dateKey]) {
                currentStudyRecords[dateKey] = {};
            }
            
            currentStudyRecords[dateKey][slotId] = {
                minutes: parseInt(minutes) || 0,
                subject: subject || '',
                notes: notes || '',
                timestamp: new Date().toISOString()
            };
            
            const studyResult = await saveUserData(userEmail, 'studyRecords', currentStudyRecords);
            saveResults.push({ type: 'studyRecords', success: studyResult.success });
        }
        
        // 2. 완수 처리 데이터 저장 (새로 추가)
        if (completedSchedules) {
            const completedResult = await saveUserData(userEmail, 'completedSchedules', completedSchedules);
            saveResults.push({ type: 'completedSchedules', success: completedResult.success });
        }
        
        // 3. 순공 실적 전체 데이터 저장 (공유 모드에서 전송된 경우)
        if (studyRecords && !slotId) {
            const studyResult = await saveUserData(userEmail, 'studyRecords', studyRecords);
            saveResults.push({ type: 'studyRecords', success: studyResult.success });
        }
        
        const allSuccess = saveResults.every(result => result.success);
        
        if (allSuccess) {
            console.log(`✅ 공유에서 데이터 업데이트 완료 - 원본 반영: ${userEmail}, ${dateKey}`);
            res.json({ 
                success: true,
                message: '데이터가 원본 스케줄에 저장되었습니다.',
                isRealTime: true,
                savedTypes: saveResults.map(r => r.type)
            });
        } else {
            console.error('❌ 일부 데이터 저장 실패:', saveResults);
            res.status(500).json({ error: '데이터 저장에 실패했습니다.' });
        }
        
    } catch (error) {
        console.error('공유 캘린더 실적 입력 오류:', error);
        res.status(500).json({ error: '실적 입력 중 오류가 발생했습니다.' });
    }
});

// 토큰 검증 API (디버깅용)
app.get('/api/debug/token/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log(`🔍 토큰 디버깅 요청: ${token}`);
        
        let result = {
            token: token,
            redis: { view: null, record: null },
            memory: { view: null, record: null },
            environment: process.env.NODE_ENV,
            envCheck: {
                hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
                hasUpstashToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
                urlPrefix: process.env.UPSTASH_REDIS_REST_URL ? process.env.UPSTASH_REDIS_REST_URL.substring(0, 30) + '...' : null
            }
        };
        
        // Redis 확인
        if (process.env.NODE_ENV === 'production' && process.env.UPSTASH_REDIS_REST_URL) {
            try {
                const { Redis } = require('@upstash/redis');
                const kvStore = Redis.fromEnv();
                
                // Redis 연결 테스트
                await kvStore.ping();
                result.redis.connectionTest = 'success';
                
                result.redis.view = await kvStore.get(`token:view:${token}`);
                result.redis.record = await kvStore.get(`token:record:${token}`);
                console.log(`📝 Redis 결과:`, result.redis);
            } catch (error) {
                result.redis.error = error.message;
                result.redis.connectionTest = 'failed';
                console.log(`❌ Redis 오류:`, error.message);
            }
        } else {
            result.redis.error = 'Redis 환경 변수 없음 또는 개발 환경';
        }
        
        // 메모리 확인
        result.memory.view = memoryStore.get(`token:view:${token}`);
        result.memory.record = memoryStore.get(`token:record:${token}`);
        result.memory.totalKeys = memoryStore.size;
        console.log(`📝 메모리 결과:`, result.memory);
        
        res.json(result);
    } catch (error) {
        console.error('토큰 디버깅 오류:', error);
        res.status(500).json({ error: error.message });
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
    <!-- 파비콘 완전 제거 및 캐시 방지 -->
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <style>
        /* 공유 화면을 본 서비스와 완전히 동일하게 만들기 */
        
        .shared-header {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 12px;
            text-align: center;
        }
        .shared-info {
            background: var(--surface-bg, #ffffff);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #667eea;
            border: 1px solid var(--border-color, #e2e8f0);
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
        
        /* 카테고리별 배경 색상 - 원본 planner와 동일 */
        .schedule-item[data-category="순공가능시간"] {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
        }
        .schedule-item[data-category="수학학원"],
        .schedule-item[data-category="학원"],
        .schedule-item[data-category="과외"] {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            color: white;
        }
        .schedule-item[data-category="기타"] {
            background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
            color: white;
        }
        .schedule-item[data-category="없음"] {
            background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
            color: white;
        }
        .completed-schedule {
            opacity: 0.7;
            text-decoration: line-through;
        }
        
        /* 순공 실적 오렌지 스타일 */
        .daily-study-time {
            position: relative;
            font-size: 9px;
            color: white;
            font-weight: 600;
            background-color: rgba(251, 146, 60, 0.9);
            padding: 2px 4px;
            border-radius: 3px;
            border: 1px solid #ea580c;
            white-space: nowrap;
            text-align: center;
            box-sizing: border-box;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.2;
            height: 18px;
            max-height: 18px;
            display: block;
            width: 100%;
            margin-bottom: 2px;
            flex-shrink: 0;
        }
        
        /* 공유 캘린더 레이아웃 개선 - 메인 캘린더와 동일하게 */
        .calendar-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 4px;
            margin-top: 20px;
        }
        
        .day-cell {
            position: relative;
            height: 140px;
            padding: 4px;
            font-size: 11px;
            border-radius: 8px;
            min-height: 44px;
            min-width: 0;
            border: 1px solid var(--border-color, #e9ecef);
            background: white;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        
        .date-number {
            font-weight: 600;
            margin-bottom: 2px;
            text-align: left;
            font-size: 12px;
            line-height: 1;
            flex-shrink: 0;
        }
        
        .schedules-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 1px;
            overflow: hidden;
            position: relative;
        }
        
        .schedule-item {
            font-size: 8px;
            padding: 1px 3px;
            border-radius: 3px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.2;
            height: 12px;
            max-height: 12px;
            min-height: 12px;
            flex-shrink: 0;
            box-sizing: border-box;
            width: 100%;
        }
        
        /* 모바일 대응 */
        @media (max-width: 768px) {
            .day-cell {
                height: 110px;
                padding: 2px;
                font-size: 9px;
            }
            
            .schedule-item {
                font-size: 7px;
                height: 10px;
                max-height: 10px;
                min-height: 10px;
            }
            
            .date-number {
                font-size: 10px;
            }
        }
        
        /* 본 서비스와 동일한 스타일 강제 적용 */
        .calendar-grid {
            font-size: 14px !important;
            line-height: 1.4 !important;
        }
        
        .day-cell {
            font-size: 12px !important;
            height: 280px !important;
            padding: 8px 8px 30px 8px !important;
            min-height: 280px !important;
        }
        
        .date-number {
            font-size: 14px !important;
            font-weight: 600 !important;
            margin-bottom: 4px !important;
        }
        
        .schedule-item {
            font-size: 10px !important;
            height: auto !important;
            min-height: 16px !important;
            padding: 2px 4px !important;
            margin-bottom: 2px !important;
            line-height: 1.2 !important;
        }
        
        .schedules-container {
            gap: 2px !important;
            font-size: 10px !important;
        }
        
        /* 순공 실적 스타일 통일 */
        .daily-study-time {
            font-size: 9px !important;
            height: 18px !important;
            padding: 2px 4px !important;
        }
        
        /* 전체 컨테이너 스타일 통일 */
        .main-content {
            font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif !important;
            font-size: 14px !important;
        }
    </style>
</head>
<body>
    <!-- 본 서비스와 완전히 동일한 구조 -->
    <div class="app">
        <!-- 사이드바 (공유 모드에서 숨김) -->
        <div class="sidebar">
            <!-- 사이드바 내용은 CSS로 숨김 처리 -->
        </div>
        
        <!-- 헤더 (공유 모드에서 숨김) -->
        <div class="header">
            <!-- 헤더 내용은 CSS로 숨김 처리 -->
        </div>
        
        <!-- 메인 컨텐츠 -->
        <div class="main-content">
            <!-- 공유 모드 알림 -->
            <div class="shared-header">
                <h1 style="color: white !important; font-size: 2rem !important; margin: 0 !important;">🏖️ 방학 순공 플래너</h1>
                <p style="color: white !important; margin: 10px 0 !important;">공유된 캘린더 <span class="permission-badge">${permissionText}</span></p>
                <div class="shared-info">
                    <p style="color: #1e293b !important;"><strong>📌 이 캘린더는 공유 링크로 접근하고 있습니다.</strong></p>
                    ${canRecord ? 
                        '<p style="color: #1e293b !important;">✅ 캘린더 보기 + 순공 시간 실적 입력이 가능합니다.</p>' : 
                        '<p style="color: #1e293b !important;">👀 캘린더와 통계만 확인할 수 있습니다.</p>'
                    }
                    ${!canRecord ? '<div class="readonly-notice" style="color: #1e293b !important;">📖 읽기 전용 모드입니다.</div>' : ''}
                </div>
            </div>
            
            <!-- 이번 주 주요 일정 -->
            <div class="weekly-schedule-section">
                <div class="section-header">
                    <h2>📋 이번 주 등록된 일정</h2>
                </div>
                <div id="weekly-schedule-content">
                    <!-- 주요 일정이 여기에 표시됩니다 -->
                </div>
            </div>
            
            <!-- 내 일정 -->
            <div class="my-schedule-section">
                <div class="section-header">
                    <h2>📚 방학 계획표</h2>
                </div>
                
                <div id="calendar-container">
                    <div id="calendar"></div>
                </div>
            </div>
            
            <!-- 주간 스케줄 평가 -->
            <div class="weekly-evaluation-section">
                <div class="section-header">
                    <h2>📊 주간 스케줄 평가</h2>
                </div>
                <div id="weekly-evaluation-content">
                    <!-- 주간 평가가 여기에 표시됩니다 -->
                </div>
            </div>
        </div>
    </div>
    
    <!-- 본 서비스와 동일한 모달들 -->
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
    
    <div id="toast-container"></div>
    
    <script>
        // 공유 모드 설정
        window.SHARED_MODE = {
            isShared: true,
            token: '${token}',
            canRecord: ${canRecord},
            userEmail: '${userEmail}'
        };
        
        // 디버깅: 공유 모드 설정 확인
        console.log('🔧 SHARED_MODE 설정:', window.SHARED_MODE);
        console.log('🌐 현재 URL:', window.location.href);
        console.log('📍 pathname:', window.location.pathname);
        
        // 공유 모드 플래그 (planner.js 로드 전에 설정)
        window.isSharedMode = true;
    </script>
    <script src="/js/planner.js"></script>
    <script>
        // planner.js 로드 완료를 기다린 후 초기화
        window.addEventListener('load', function() {
            // 약간의 지연을 두어 planner.js가 완전히 초기화되도록 함
            setTimeout(function() {
                console.log('🔧 공유 모드 초기화 시작');
                
                // 메뉴 숨기기
                const sidebar = document.querySelector('.sidebar');
                if (sidebar) sidebar.style.display = 'none';
                const header = document.querySelector('.header');
                if (header) header.style.display = 'none';
                
                // 불필요한 버튼들 및 섹션 숨기기
                const scheduleBtn = document.getElementById('schedule-register-btn');
                if (scheduleBtn) scheduleBtn.style.display = 'none';
                const mbtiBtn = document.getElementById('mbti-coaching-btn');
                if (mbtiBtn) mbtiBtn.style.display = 'none';
                const shareBtn = document.getElementById('share-calendar-btn');
                if (shareBtn) shareBtn.style.display = 'none';
                const logoutBtn = document.getElementById('logout-btn');
                if (logoutBtn) logoutBtn.style.display = 'none';
                
                // 주간 스케줄 평가 섹션 숨기기
                const weeklyEvaluationSection = document.querySelector('.weekly-evaluation-section');
                if (weeklyEvaluationSection) weeklyEvaluationSection.style.display = 'none';
                
                // 공유 데이터 로드
                loadSharedData();
            }, 500); // 0.5초 지연
        });
        
        async function loadSharedData() {
            try {
                console.log('📡 공유 데이터 로드 시작, 토큰:', window.SHARED_MODE.token);
                const response = await fetch(\`/api/shared/\${window.SHARED_MODE.token}/data\`);
                
                if (!response.ok) {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                }
                
                const data = await response.json();
                console.log('📊 수신된 공유 데이터:', data);
                
                // 기존 전역 변수에 데이터 로드
                window.schedules = data.schedules || [];
                window.studyRecords = data.studyRecords || {};
                window.completedSchedules = data.completedSchedules || {};
                
                // 호환성을 위해 글로벌 스코프에도 설정
                schedules = window.schedules;
                studyRecords = window.studyRecords;
                completedSchedules = window.completedSchedules;
                
                if (data.vacationPeriod) {
                    vacationStartDate = new Date(data.vacationPeriod.start);
                    vacationEndDate = new Date(data.vacationPeriod.end);
                    console.log('📅 방학 기간 설정:', vacationStartDate, '~', vacationEndDate);
                }
                
                // schedulesByDate 생성
                if (typeof generateSchedulesByDate === 'function') {
                    generateSchedulesByDate();
                    console.log('📋 schedulesByDate 생성 완료');
                } else {
                    console.error('❌ generateSchedulesByDate 함수를 찾을 수 없습니다');
                }

                // 캘린더 렌더링 시도
                console.log('🎯 캘린더 렌더링 시작');
                if (typeof renderCalendar === 'function') {
                    renderCalendar();
                } else {
                    console.error('❌ renderCalendar 함수를 찾을 수 없습니다');
                }
                
                if (typeof updateWeeklySchedule === 'function') {
                    updateWeeklySchedule();
                }
                
                // 주간 평가는 공유 모드에서 제외
                // if (typeof updateWeeklyEvaluation === 'function') {
                //     updateWeeklyEvaluation();
                // }
                
                // 공유 모드에서 모달 이벤트 리스너 등록
                setupSharedModeEventListeners();
                
                console.log('✅ 공유 데이터 로드 및 렌더링 완료');
            } catch (error) {
                console.error('❌ 공유 데이터 로드 오류:', error);
                alert('공유 데이터를 불러오는 중 오류가 발생했습니다: ' + error.message);
            }
        }
        
        // 공유 모드용 완수 토글 함수
        window.toggleScheduleComplete = function(scheduleId, dateKey) {
            console.log('🔍 완수 처리 시도 - 권한 체크:', {
                canRecord: window.SHARED_MODE?.canRecord,
                pathname: window.location.pathname,
                token: window.SHARED_MODE?.token
            });
            
            // 권한 체크: canRecord=true AND URL에 /record/ 포함
            if (!window.SHARED_MODE?.canRecord || !window.location.pathname.includes('/record/')) {
                const message = !window.SHARED_MODE?.canRecord 
                    ? '읽기 전용 모드에서는 완수 처리할 수 없습니다.'
                    : '실적 입력 권한이 있는 링크로 접근해주세요.';
                showToast(message, 'error');
                return;
            }
            
            console.log('✅ 완수 처리 권한 확인됨 - 진행합니다.');
            
            if (!window.completedSchedules[dateKey]) {
                window.completedSchedules[dateKey] = {};
            }
            
            const isCompleted = window.completedSchedules[dateKey][scheduleId];
            
            // 완수 상태 토글
            if (isCompleted) {
                delete window.completedSchedules[dateKey][scheduleId];
                showToast('완수 취소되었습니다.', 'info');
            } else {
                window.completedSchedules[dateKey][scheduleId] = true;
                showToast('완수 처리되었습니다!', 'success');
            }
            
            // 모달 내 해당 스케줄 카드 즉시 업데이트
            updateScheduleCardInModal(scheduleId, !isCompleted);
            
            // 서버에 완수 데이터 저장
            fetch(\`/api/shared/\${window.SHARED_MODE.token}/study-record\`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    dateKey: dateKey,
                    studyRecords: window.studyRecords,
                    completedSchedules: window.completedSchedules
                })
            }).then(response => {
                if (!response.ok) {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                }
                return response.json();
            }).then(data => {
                console.log('✅ 완수 데이터 서버 저장 성공:', data);
                if (data.isRealTime) {
                    console.log('🔄 본 서비스에 실시간 반영 완료');
                }
            }).catch(error => {
                console.error('❌ 완수 데이터 저장 오류:', error);
                showToast('서버 저장에 실패했습니다. 다시 시도해주세요.', 'error');
                
                // 실패 시 UI 되돌리기
                if (!isCompleted) {
                    delete window.completedSchedules[dateKey][scheduleId];
                } else {
                    window.completedSchedules[dateKey][scheduleId] = true;
                }
                updateScheduleCardInModal(scheduleId, isCompleted);
            });
            
            // 캘린더 다시 렌더링
            renderCalendar();
            
            // 모달 내용 업데이트
            setTimeout(() => {
                if (typeof showDaySummary === 'function') {
                    showDaySummary(dateKey);
                } else {
                    console.log('📝 showDaySummary 함수 없음 - 모달 업데이트 건너뛰기');
                }
            }, 100);
        }
        
        // 모달 내 스케줄 카드 즉시 업데이트 함수 (공유 모드용)
        function updateScheduleCardInModal(scheduleId, isCompleted) {
            const scheduleCard = document.getElementById(\`schedule-card-\${scheduleId}\`);
            if (!scheduleCard) return;
            
            const scheduleInfo = scheduleCard.querySelector('.schedule-info');
            const completeButton = scheduleCard.querySelector('.btn-complete');
            
            if (isCompleted) {
                // 완수 처리: 줄긋기 추가
                scheduleCard.classList.add('completed');
                if (scheduleInfo) {
                    scheduleInfo.style.textDecoration = 'line-through';
                    scheduleInfo.style.opacity = '0.6';
                }
                if (completeButton) {
                    completeButton.textContent = '완수 취소';
                    completeButton.classList.add('completed');
                }
            } else {
                // 완수 취소: 줄긋기 제거
                scheduleCard.classList.remove('completed');
                if (scheduleInfo) {
                    scheduleInfo.style.textDecoration = 'none';
                    scheduleInfo.style.opacity = '1';
                }
                if (completeButton) {
                    completeButton.textContent = '완수';
                    completeButton.classList.remove('completed');
                }
            }
        }
        
        // 공유 모드용 모달 이벤트 리스너 설정
        function setupSharedModeEventListeners() {
            console.log('🔗 공유 모드 이벤트 리스너 설정 시작');
            
            // 권한에 따른 완수 버튼 처리
            console.log('🔍 권한 체크:', {
                canRecord: window.SHARED_MODE?.canRecord,
                pathname: window.location.pathname
            });
            
            if (window.SHARED_MODE?.canRecord && window.location.pathname.includes('/record/')) {
                console.log('✅ 실적 입력 권한 확인됨 - 완수 버튼 활성화');
            } else {
                console.log('🔒 읽기 전용 모드 - 완수 버튼 숨김');
                hideCompleteButtonsInReadOnlyMode();
            }
            
            // 모달 닫기 이벤트들
            const dayModalClose = document.getElementById('day-modal-close');
            if (dayModalClose) {
                dayModalClose.addEventListener('click', () => {
                    closeModal('day-summary-modal');
                });
                console.log('✅ 일별 모달 닫기 이벤트 등록');
            }
            
            const studyModalClose = document.getElementById('study-modal-close');
            if (studyModalClose) {
                studyModalClose.addEventListener('click', () => {
                    closeModal('study-time-modal');
                });
                console.log('✅ 순공 시간 모달 닫기 이벤트 등록');
            }
            
            // closeModal 함수가 전역에서 사용 가능한지 확인
            if (typeof closeModal !== 'function') {
                console.warn('⚠️ closeModal 함수를 찾을 수 없습니다');
            }
            
            console.log('🎯 공유 모드 이벤트 리스너 설정 완료');
        }
        
        // 읽기 전용 모드에서 완수 버튼 숨기기
        function hideCompleteButtonsInReadOnlyMode() {
            console.log('🔒 완수 버튼 숨김 함수 실행 시작');
            
            // 강력한 완수 버튼 숨김 함수
            function forceHideCompleteButtons() {
                const completeButtons = document.querySelectorAll('.btn-complete');
                console.log(\`🔍 발견된 완수 버튼 수: \${completeButtons.length}\`);
                
                completeButtons.forEach((btn, index) => {
                    btn.style.display = 'none !important';
                    btn.style.visibility = 'hidden';
                    btn.disabled = true;
                    btn.remove(); // 아예 DOM에서 제거
                    console.log(\`🚫 완수 버튼 \${index + 1} 제거됨\`);
                });
                
                return completeButtons.length;
            }
            
            // 즉시 실행
            const initialCount = forceHideCompleteButtons();
            
            // 정기적으로 체크 (setInterval)
            const intervalId = setInterval(() => {
                const count = forceHideCompleteButtons();
                if (count > 0) {
                    console.log(\`🔄 추가 완수 버튼 \${count}개 제거\`);
                }
            }, 500); // 0.5초마다
            
            // MutationObserver로 실시간 감지
            const observer = new MutationObserver((mutations) => {
                let found = false;
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        const count = forceHideCompleteButtons();
                        if (count > 0) {
                            found = true;
                        }
                    }
                });
                if (found) {
                    console.log('🔍 MutationObserver: 새로운 완수 버튼 감지 및 제거');
                }
            });
            
            // DOM 전체 관찰
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            console.log(\`🔒 읽기 전용 모드: 완수 버튼 숨김 처리 완료 (초기 \${initialCount}개 제거)\`);
            
            // 5초 후 interval 정리 (성능을 위해)
            setTimeout(() => {
                clearInterval(intervalId);
                console.log('⏰ 완수 버튼 체크 interval 정리됨');
            }, 5000);
        }
    </script>
</body>
</html>
    `;
}

// 🔧 디버깅용: 토큰 상태 확인 API
app.get('/api/debug/token/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🔍 토큰 디버깅 요청:', token);
        
        const result = {
            token: token,
            redisCheck: null,
            memoryCheck: null,
            timestamp: new Date().toISOString()
        };
        
        // Redis 체크
        try {
            const { Redis } = require('@upstash/redis');
            const kvStore = Redis.fromEnv();
            
            await kvStore.ping();
            console.log('🔗 Redis 연결 성공');
            
            const viewUser = await kvStore.get(`token:view:${token}`);
            const recordUser = await kvStore.get(`token:record:${token}`);
            
            result.redisCheck = {
                connected: true,
                viewUser: viewUser || null,
                recordUser: recordUser || null
            };
        } catch (error) {
            result.redisCheck = {
                connected: false,
                error: error.message
            };
        }
        
        // 메모리 체크
        const memViewUser = memoryStore.get(`token:view:${token}`);
        const memRecordUser = memoryStore.get(`token:record:${token}`);
        
        result.memoryCheck = {
            viewUser: memViewUser || null,
            recordUser: memRecordUser || null,
            totalTokens: memoryStore.size
        };
        
        console.log('📊 토큰 디버깅 결과:', result);
        res.json(result);
        
    } catch (error) {
        console.error('토큰 디버깅 오류:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`✨ 서버가 시작되었습니다. http://localhost:${port} 에서 확인하세요.`);
});