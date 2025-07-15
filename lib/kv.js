// 로컬 개발 환경에서는 메모리 저장소 사용, 프로덕션에서는 Vercel KV 사용
let kvStore;

if (process.env.VERCEL || process.env.KV_REST_API_URL) {
    // Vercel 환경 또는 KV가 설정된 경우
    const { kv } = require('@vercel/kv');
    kvStore = kv;
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
        await kvStore.set(key, JSON.stringify(data));
        return { success: true };
    } catch (error) {
        console.error('KV 데이터 저장 오류:', error);
        return { success: false, error: error.message };
    }
}

// 사용자 데이터 조회
async function getUserData(userEmail, dataType) {
    try {
        const key = `user:${userEmail}:${dataType}`;
        const data = await kvStore.get(key);
        return { 
            success: true, 
            data: data ? JSON.parse(data) : null 
        };
    } catch (error) {
        console.error('KV 데이터 조회 오류:', error);
        return { success: false, error: error.message };
    }
}

// 사용자의 모든 데이터 조회
async function getAllUserData(userEmail) {
    try {
        const pattern = `user:${userEmail}:*`;
        const keys = await kvStore.keys(pattern);
        const data = {};
        
        for (const key of keys) {
            const value = await kvStore.get(key);
            const dataType = key.split(':')[2]; // user:email:dataType에서 dataType 추출
            data[dataType] = value ? JSON.parse(value) : null;
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