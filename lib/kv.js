// 로컬 개발 환경에서는 메모리 저장소 사용, 프로덕션에서는 Vercel KV 사용
let kvStore;
const memoryStore = new Map(); // 모듈 레벨에서 정의

if (process.env.VERCEL || process.env.UPSTASH_REDIS_REST_URL) {
    // Vercel 환경 또는 Upstash Redis가 설정된 경우
    console.log('🔧 Upstash Redis 연결 중...', {
        VERCEL: !!process.env.VERCEL,
        UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN
    });
    const { Redis } = require('@upstash/redis');
    kvStore = Redis.fromEnv();
    console.log('✅ Upstash Redis 연결 완료');
} else {
    // 로컬 개발 환경 - 메모리 저장소 사용
    console.log('⚠️  로컬 개발 환경: 메모리 저장소를 사용합니다. 데이터는 서버 재시작 시 초기화됩니다.');
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
        const rawData = await kvStore.get(key);
        console.log(`📦 KV 조회 원본: ${key} ->`, typeof rawData, rawData);
        
        if (!rawData) {
            console.log(`📦 KV 조회 결과: ${key} -> null`);
            return { success: true, data: null };
        }
        
        // 데이터가 이미 객체인 경우 (Upstash Redis가 자동으로 파싱한 경우)
        if (typeof rawData === 'object') {
            console.log(`📦 KV 조회 결과: ${key} -> object (auto-parsed)`);
            return { success: true, data: rawData };
        }
        
        // 데이터가 문자열인 경우 JSON 파싱 시도
        if (typeof rawData === 'string') {
            try {
                const parsedData = JSON.parse(rawData);
                console.log(`📦 KV 조회 결과: ${key} -> parsed from JSON`);
                return { success: true, data: parsedData };
            } catch (parseError) {
                console.error(`❌ JSON 파싱 실패 (${key}):`, rawData, parseError);
                // 파싱 실패 시 원본 데이터 반환 (문자열 그대로)
                return { success: true, data: rawData };
            }
        }
        
        // 기타 타입 (숫자, 불린 등)은 그대로 반환
        console.log(`📦 KV 조회 결과: ${key} -> ${typeof rawData}`);
        return { success: true, data: rawData };
        
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
                const rawValue = await kvStore.get(key);
                
                if (!rawValue) {
                    data[dataType] = null;
                    continue;
                }
                
                // 데이터가 이미 객체인 경우
                if (typeof rawValue === 'object') {
                    data[dataType] = rawValue;
                    continue;
                }
                
                // 데이터가 문자열인 경우 JSON 파싱 시도
                if (typeof rawValue === 'string') {
                    try {
                        data[dataType] = JSON.parse(rawValue);
                    } catch (parseError) {
                        console.error(`❌ JSON 파싱 실패 (${key}):`, rawValue, parseError);
                        data[dataType] = rawValue; // 파싱 실패 시 원본 반환
                    }
                } else {
                    data[dataType] = rawValue;
                }
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
    deleteUserData,
    memoryStore
}; 