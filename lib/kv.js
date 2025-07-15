// 로컬 개발 환경에서는 메모리 저장소 사용, 프로덕션에서는 Vercel KV 사용
let kvStore;

if (process.env.VERCEL || process.env.KV_REST_API_URL) {
    // Vercel 환경 또는 KV가 설정된 경우
    console.log('🔧 Vercel KV 연결 중...', {
        VERCEL: !!process.env.VERCEL,
        KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN
    });
    const { kv } = require('@vercel/kv');
    kvStore = kv;
    console.log('✅ Vercel KV 연결 완료');
} else {
    // 로컬 개발 환경 - 메모리 저장소 사용
    console.log('⚠️  로컬 개발 환경: 메모리 저장소를 사용합니다. 데이터는 서버 재시작 시 초기화됩니다.');
    const memoryStore = new Map();
    kvStore = {
        async set(key, value) {
            memoryStore.set(key, value);
        },
        async get(key) {
            return memoryStore.get(key) || null;
        },
        async del(key) {
            memoryStore.delete(key);
        },
        async keys(pattern) {
            const keys = Array.from(memoryStore.keys());
            if (pattern.endsWith('*')) {
                const prefix = pattern.slice(0, -1);
                return keys.filter(key => key.startsWith(prefix));
            }
            return keys.filter(key => key === pattern);
        }
    };
}

// 사용자 데이터 저장
async function saveUserData(userEmail, dataType, data) {
    try {
        const key = `user:${userEmail}:${dataType}`;
        console.log(`💾 KV 저장 시도: ${key}`, typeof data, data ? 'has data' : 'no data');
        await kvStore.set(key, JSON.stringify(data));
        console.log(`✅ KV 저장 성공: ${key}`);
        return { success: true };
    } catch (error) {
        console.error(`❌ KV 데이터 저장 오류 (${userEmail}:${dataType}):`, error);
        return { success: false, error: error.message };
    }
}

// 사용자 데이터 조회
async function getUserData(userEmail, dataType) {
    try {
        const key = `user:${userEmail}:${dataType}`;
        console.log(`🔍 KV 조회 시도: ${key}`);
        const data = await kvStore.get(key);
        console.log(`📦 KV 조회 결과: ${key} ->`, data ? 'data found' : 'null');
        return { 
            success: true, 
            data: data ? JSON.parse(data) : null 
        };
    } catch (error) {
        console.error(`❌ KV 데이터 조회 오류 (${userEmail}:${dataType}):`, error);
        return { success: false, error: error.message };
    }
}

// 사용자의 모든 데이터 조회
async function getAllUserData(userEmail) {
    try {
        // keys() 메서드 대신 개별적으로 각 데이터 타입을 조회
        const dataTypes = ['vacationPeriod', 'schedules', 'studyRecords', 'completedSchedules'];
        const data = {};
        
        for (const dataType of dataTypes) {
            try {
                const key = `user:${userEmail}:${dataType}`;
                const value = await kvStore.get(key);
                data[dataType] = value ? JSON.parse(value) : null;
            } catch (typeError) {
                console.error(`${dataType} 조회 오류:`, typeError);
                data[dataType] = null;
            }
        }
        
        return { success: true, data };
    } catch (error) {
        console.error('KV 전체 데이터 조회 오류:', error);
        return { success: false, error: error.message };
    }
}

// 사용자 데이터 삭제
async function deleteUserData(userEmail, dataType) {
    try {
        const key = `user:${userEmail}:${dataType}`;
        await kvStore.del(key);
        return { success: true };
    } catch (error) {
        console.error('KV 데이터 삭제 오류:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    saveUserData,
    getUserData,
    getAllUserData,
    deleteUserData
}; 