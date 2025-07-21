require('dotenv').config();

async function checkSunnyData() {
    try {
        // 환경 변수 확인
        if (!process.env.UPSTASH_REDIS_REST_URL) {
            console.log('❌ Upstash Redis URL이 없어서 로컬 환경으로 진행합니다');
            return;
        }

        const { Redis } = require('@upstash/redis');
        const kvStore = Redis.fromEnv();
        
        console.log('=== sunnyhan.js@gmail.com 회원 데이터 조회 ===');
        
        const email = 'sunnyhan.js@gmail.com';
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
                
                if (dataType === 'vacationPeriod') {
                    console.log('🎯 방학 기간 데이터 상세 분석:');
                    console.log('📄 원본:', rawData);
                    
                    if (typeof rawData === 'object') {
                        console.log('📅 시작일:', rawData.start);
                        console.log('📅 종료일:', rawData.end);
                        
                        // 날짜 파싱 테스트
                        if (rawData.start) {
                            const [year, month, day] = rawData.start.split('-').map(Number);
                            const startDate = new Date(year, month - 1, day);
                            console.log('🔍 파싱된 시작일:', startDate.toDateString());
                        }
                    }
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

checkSunnyData(); 