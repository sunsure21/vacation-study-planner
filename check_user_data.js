const { Redis } = require('@upstash/redis');

async function checkUserData() {
    try {
        const kvStore = Redis.fromEnv();
        console.log('=== eunsunjun@gmail.com 회원 데이터 조회 ===');
        
        const email = 'eunsunjun@gmail.com';
        const dataTypes = ['vacationPeriod', 'schedules', 'studyRecords', 'completedSchedules'];
        
        for (const dataType of dataTypes) {
            try {
                const key = `user:${email}:${dataType}`;
                console.log(`\n🔍 조회 중: ${key}`);
                
                const rawData = await kvStore.get(key);
                console.log(`📦 원본 데이터 타입: ${typeof rawData}`);
                
                if (!rawData) {
                    console.log('❌ 데이터 없음');
                    continue;
                }
                
                if (typeof rawData === 'object') {
                    console.log('📄 데이터 (파싱됨):', JSON.stringify(rawData, null, 2));
                } else if (typeof rawData === 'string') {
                    try {
                        const parsed = JSON.parse(rawData);
                        console.log('📄 데이터 (JSON 파싱):', JSON.stringify(parsed, null, 2));
                    } catch (e) {
                        console.log('📄 원본 문자열:', rawData);
                    }
                } else {
                    console.log('📄 데이터:', rawData);
                }
            } catch (error) {
                console.error(`❌ ${dataType} 조회 오류:`, error.message);
            }
        }
        
        console.log('\n=== 조회 완료 ===');
    } catch (error) {
        console.error('❌ Redis 연결 오류:', error.message);
    }
}

checkUserData().catch(console.error); 