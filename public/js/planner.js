// 🚨 강제 로그 - JavaScript 파일 로드 확인
console.log('🔥 planner.js 파일 로드됨!');
console.log('📅 현재 시간:', new Date());
console.log('🌐 현재 URL:', window.location.href);

// 전역 변수
let vacationStartDate = null;
let vacationEndDate = null;
let schedules = [];
let schedulesByDate = {};
let studyRecords = {};
let completedSchedules = {}; // 완수된 스케줄을 저장하는 객체 {dateKey: {scheduleId: true}}
let currentUser = null; // 현재 로그인한 사용자 정보

// 유틸리티 함수
function toYYYYMMDD(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 세션 유효성 확인 함수
async function checkSession() {
    try {
        const response = await fetch('/check-session');
        if (response.ok) {
            const data = await response.json();
            return data.authenticated;
        }
        return false;
    } catch (error) {
        console.error('세션 확인 오류:', error);
        return false;
    }
}

// 현재 사용자 정보 가져오기
async function getCurrentUser(skipSessionCheck = false) {
    if (currentUser) return currentUser;
    
    try {
        // skipSessionCheck가 true면 세션 체크를 건너뛰고 바로 사용자 정보 조회
        if (!skipSessionCheck) {
            // 먼저 세션 상태 확인
            const sessionResponse = await fetch('/check-session');
            if (!sessionResponse.ok) {
                console.log('세션 체크 실패, 로그인 페이지로 이동');
                window.location.href = '/login';
                return null;
            }
            
            const sessionData = await sessionResponse.json();
            if (!sessionData.authenticated) {
                console.log('인증되지 않은 사용자, 로그인 페이지로 이동');
                window.location.href = '/login';
                return null;
            }
        }
        
        // 세션이 유효하면 사용자 정보 가져오기
        const response = await fetch('/api/user');
        if (response.ok) {
            currentUser = await response.json();
            return currentUser;
        } else if (response.status === 302 || response.status === 401) {
            console.log('사용자 정보 조회 실패 (인증 오류), 로그인 페이지로 이동');
            window.location.href = '/login';
            return null;
        }
    } catch (error) {
        console.error('사용자 정보를 가져오는 중 오류:', error);
        console.log('오류로 인해 로그인 페이지로 이동');
        window.location.href = '/login';
        return null;
    }
    return null;
}

// 사용자별 localStorage 키 생성
function getUserStorageKey(key) {
    const userId = currentUser ? currentUser.id : 'guest';
    return `${userId}_${key}`;
}

// 대한민국 서울 기준 현재 날짜 가져오기
function getCurrentKoreanDate() {
    const now = new Date();
    // 한국 시간대로 변환
    const koreaTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
    return koreaTime;
}

// 대한민국 서울 기준 현재 날짜 문자열 (YYYY-MM-DD)
function getCurrentKoreanDateString() {
    const now = new Date();
    const koreanDateString = now.toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
    
    // "2025. 07. 14." 형식을 "2025-07-14" 형식으로 변환
    const parts = koreanDateString.split('. ');
    const year = parts[0];
    const month = parts[1];
    const day = parts[2].replace('.', '');
    
    return `${year}-${month}-${day}`;
}

function formatDate(date) {
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatTime(hours, minutes) {
    const period = hours >= 12 ? '오후' : '오전';
    const displayHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    return `${period} ${displayHours}시 ${minutes.toString().padStart(2, '0')}분`;
}

function formatMinutes(minutes) {
    if (minutes === null || minutes === undefined || minutes === 0) return '0분';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}분`;
    if (mins === 0) return `${hours}시간`;
    return `${hours}시간 ${mins}분`;
}

function getDayName(dayIndex) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[dayIndex];
}

function getWeekRange(date) {
    const start = new Date(date);
    const day = start.getDay();
    // 월요일부터 시작하도록 수정 (0=일요일, 1=월요일)
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    
    return {
        start: start,
        end: end,
        text: `${start.getMonth() + 1}월 ${start.getDate()}일 - ${end.getMonth() + 1}월 ${end.getDate()}일`
    };
}

// 화면 전환 함수
function showSetupScreen() {
    document.getElementById('setup-screen').style.display = 'flex';
    document.getElementById('planner-screen').style.display = 'none';
}

function showPlannerScreen() {
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('planner-screen').style.display = 'block';
    
    updateVacationDisplay();
    generateSchedulesByDate();  // 먼저 스케줄 데이터 생성
    updateWeeklySchedule();     // 그 다음 이번주 스케줄 업데이트
    renderCalendar();
    updateWeeklyEvaluation();
    updateCurrentDateTime();
    
    // 시간 업데이트 타이머 시작
    if (window.timeUpdateInterval) {
        clearInterval(window.timeUpdateInterval);
    }
    window.timeUpdateInterval = setInterval(updateCurrentDateTime, 1000);
}

function updateVacationDisplay() {
    if (vacationStartDate && vacationEndDate) {
        const startStr = formatDate(vacationStartDate);
        const endStr = formatDate(vacationEndDate);
        document.getElementById('vacation-period-display').textContent = `${startStr} ~ ${endStr}`;
    }
}

// 현재 대한민국 서울 시간 업데이트
function updateCurrentDateTime() {
    const now = new Date();
    
    // 한국 시간대로 날짜와 시간 정보 가져오기
    const koreaOptions = {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "long",
        hour12: false
    };
    
    const koreanDateTime = now.toLocaleDateString("ko-KR", koreaOptions);
    
    // 한국 시간대의 요일 정보 가져오기
    const dayName = now.toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        weekday: "short"
    });
    
    // 한국 시간대의 시간 정보 가져오기
    const timeString = now.toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
    
    // 한국 시간대의 날짜 정보 가져오기
    const dateString = now.toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "long",
        day: "numeric"
    });
    
    const dateTimeString = `${dateString} ${dayName}요일 ${timeString}`;
    
    const element = document.getElementById('current-date-time');
    if (element) {
        element.textContent = dateTimeString;
    }
}

function updateWeeklySchedule() {
    const now = getCurrentKoreanDate();
    const weekRange = getWeekRange(now);
    
    document.getElementById('current-week-range').textContent = weekRange.text;
    
    // 이번 주 등록된 스케줄 표시 (식사, 취침 제외)
    const weeklySchedulesContainer = document.getElementById('weekly-registered-schedules');
    const weeklyStudyContainer = document.getElementById('weekly-study-hours');
    
    let weeklySchedulesHtml = '';
    let totalStudyHours = 0;
    
    console.log('현재 schedulesByDate:', schedulesByDate);
    console.log('이번주 범위:', weekRange);
    
    for (let d = new Date(weekRange.start); d <= weekRange.end; d.setDate(d.getDate() + 1)) {
        const dateKey = toYYYYMMDD(d);
        const daySchedules = schedulesByDate[dateKey] || [];
        
        console.log(`${dateKey} 스케줄:`, daySchedules);
        
        // 학원, 기타 카테고리만 필터링
        const mainSchedules = daySchedules.filter(schedule => 
            !schedule.isStudySlot && 
            schedule.category !== '식사' && 
            schedule.category !== '취침'
        );
        
        // 시간순으로 정렬
        mainSchedules.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
        
        if (mainSchedules.length > 0) {
            weeklySchedulesHtml += `<div class="weekly-day-schedules">`;
            weeklySchedulesHtml += `<strong>${getDayName(d.getDay())}: </strong>`;
            mainSchedules.forEach(schedule => {
                weeklySchedulesHtml += `${schedule.title || schedule.category} (${schedule.startTime}-${schedule.endTime}), `;
            });
            weeklySchedulesHtml = weeklySchedulesHtml.slice(0, -2) + '</div>';
        }
        
        // 순공 가능 시간 계산
        const studySlots = daySchedules.filter(s => s.isStudySlot);
        studySlots.forEach(slot => {
            totalStudyHours += slot.duration || 0;
        });
    }
    
    if (weeklySchedulesHtml === '') {
        weeklySchedulesHtml = '<p>등록된 스케줄이 없습니다.</p>';
    }
    
    weeklySchedulesContainer.innerHTML = weeklySchedulesHtml;
    
    // 순공 가능 시간 계산 (24시간 - 식사, 학원, 취침, 기타 시간)
    let studyHoursHtml = '';
    let totalWeeklyStudyHours = 0;
    
    for (let d = new Date(weekRange.start); d <= weekRange.end; d.setDate(d.getDate() + 1)) {
        const dateKey = toYYYYMMDD(d);
        const daySchedules = schedulesByDate[dateKey] || [];
        
        // 해당 날짜의 실제 순공 시간 슬롯들을 계산해서 사용
        const studySlots = daySchedules.filter(s => s.isStudySlot);
        let totalStudySlotMinutes = 0;
        
        if (studySlots.length > 0) {
            // 순공 슬롯이 있으면 그 시간들의 합
            studySlots.forEach(slot => {
                totalStudySlotMinutes += slot.duration || 0;
            });
    } else {
            // 순공 슬롯이 없으면 기본 24시간 (00:00~24:00)
            totalStudySlotMinutes = 24 * 60; // 1440분
        }
        
        const availableStudyMinutes = totalStudySlotMinutes;
        const availableStudyHours = Math.max(0, Math.floor(availableStudyMinutes / 60));
        const availableStudyMinutesRemainder = Math.max(0, availableStudyMinutes % 60);
        
        // 실제 순공 시간 계산
        const dayStudyRecord = studyRecords[dateKey] || {};
        const actualStudyMinutes = Object.values(dayStudyRecord).reduce((sum, record) => {
            return sum + (record.minutes || 0);
        }, 0);
        const actualStudyHours = Math.floor(actualStudyMinutes / 60);
        const actualStudyMinutesRemainder = actualStudyMinutes % 60;
        
        totalWeeklyStudyHours += availableStudyHours + (availableStudyMinutesRemainder / 60);
        
        const dayName = getDayName(d.getDay());
        
        // 실제 순공 시간이 있으면 표시, 없으면 순공 가능 시간 표시
        if (actualStudyMinutes > 0) {
            if (actualStudyMinutesRemainder > 0) {
                studyHoursHtml += `<p>• ${dayName}: <span style="color: #10b981; font-weight: bold;">${actualStudyHours}시간 ${actualStudyMinutesRemainder}분</span> (실제 순공)</p>`;
            } else {
                studyHoursHtml += `<p>• ${dayName}: <span style="color: #10b981; font-weight: bold;">${actualStudyHours}시간</span> (실제 순공)</p>`;
            }
        } else {
            if (availableStudyMinutesRemainder > 0) {
                studyHoursHtml += `<p>• ${dayName}: ${availableStudyHours}시간 ${availableStudyMinutesRemainder}분 (가능)</p>`;
            } else {
                studyHoursHtml += `<p>• ${dayName}: ${availableStudyHours}시간 (가능)</p>`;
            }
        }
    }
    
    // 이번주 총 실제 순공 시간 계산
    let totalWeeklyActualStudyMinutes = 0;
    for (let d = new Date(weekRange.start); d <= weekRange.end; d.setDate(d.getDate() + 1)) {
        const dateKey = toYYYYMMDD(d);
        const dayStudyRecord = studyRecords[dateKey] || {};
        const actualStudyMinutes = Object.values(dayStudyRecord).reduce((sum, record) => {
            return sum + (record.minutes || 0);
        }, 0);
        totalWeeklyActualStudyMinutes += actualStudyMinutes;
    }
    
    const totalWeeklyActualStudyHours = Math.floor(totalWeeklyActualStudyMinutes / 60);
    const totalWeeklyActualStudyMinutesRemainder = totalWeeklyActualStudyMinutes % 60;
    
    studyHoursHtml += `<hr>`;
    studyHoursHtml += `<p><strong>이번주 총 순공 가능 시간: ${Math.floor(totalWeeklyStudyHours)}시간 ${Math.floor((totalWeeklyStudyHours % 1) * 60)}분</strong></p>`;
    
    if (totalWeeklyActualStudyMinutes > 0) {
        studyHoursHtml += `<p><strong style="color: #10b981;">이번주 총 실제 순공 시간: ${totalWeeklyActualStudyHours}시간 ${totalWeeklyActualStudyMinutesRemainder}분</strong></p>`;
        
        const weeklyEfficiency = totalWeeklyStudyHours > 0 ? Math.round((totalWeeklyActualStudyMinutes / (totalWeeklyStudyHours * 60)) * 100) : 0;
        studyHoursHtml += `<p><strong style="color: #8b5cf6;">이번주 시간 점유율: ${weeklyEfficiency}%</strong></p>`;
    }
    
    weeklyStudyContainer.innerHTML = studyHoursHtml;
}

// 데이터 관리 함수
async function loadDataFromStorage() {
    console.log('📊 데이터 로딩 시작...');
    
    await getCurrentUser(true); // 이미 세션 체크를 했으므로 중복 체크 건너뛰기
    
    if (!currentUser) {
        console.log('⚠️ 사용자 정보를 불러올 수 없습니다. 로컬 스토리지를 사용합니다.');
        return loadFromLocalStorage();
    }
    
    try {
        console.log('🌐 KV 데이터베이스에서 데이터 로드 시도...');
        // KV 데이터베이스에서 전체 데이터 로드
        const response = await fetch('/api/user/data');
        console.log(`📡 API 응답 상태: ${response.status}`);
        
        if (response.ok) {
            const result = await response.json();
            console.log('📄 API 응답 데이터:', result);
            
            if (result.success && result.data) {
                const data = result.data;
                
                // KV에 데이터가 있는지 확인
                const hasKVData = data.vacationPeriod || data.schedules?.length > 0 || 
                                 Object.keys(data.studyRecords || {}).length > 0 || 
                                 Object.keys(data.completedSchedules || {}).length > 0;
                
                console.log(`📊 KV 데이터 존재 여부: ${hasKVData}`);
                
                if (hasKVData) {
                    // KV에서 데이터 로드
                    if (data.vacationPeriod) {
                        vacationStartDate = new Date(data.vacationPeriod.start + 'T00:00:00');
                        vacationEndDate = new Date(data.vacationPeriod.end + 'T00:00:00');
                        console.log(`📅 방학 기간 로드: ${vacationStartDate} ~ ${vacationEndDate}`);
                    }
                    
                    schedules = data.schedules || [];
                    studyRecords = data.studyRecords || {};
                    completedSchedules = data.completedSchedules || {};
                    
                    console.log('✅ KV 데이터베이스에서 데이터를 성공적으로 로드했습니다.');
                    return;
                } else {
                    // KV에 데이터가 없으면 로컬 스토리지에서 마이그레이션 시도
                    console.log('📦 KV에 저장된 데이터가 없습니다. 로컬 스토리지에서 마이그레이션을 시도합니다.');
                    await migrateFromLocalStorage();
                    return;
                }
            } else {
                console.log('⚠️ API 응답이 유효하지 않습니다. 로컬 스토리지를 사용합니다.');
                return loadFromLocalStorage();
            }
        } else {
            console.log(`❌ API 호출 실패 (${response.status}). 로컬 스토리지를 사용합니다.`);
            return loadFromLocalStorage();
        }
    } catch (error) {
        console.error('❌ KV 데이터 로드 중 오류:', error);
        console.log('🔄 로컬 스토리지로 폴백합니다.');
        return loadFromLocalStorage();
    }
}

// 로컬 스토리지에서 KV로 데이터 마이그레이션
async function migrateFromLocalStorage() {
    console.log('🔄 로컬 스토리지에서 KV로 데이터 마이그레이션 시작...');
    
    // 로컬 스토리지에서 데이터 로드
    loadFromLocalStorage();
    
    // 로컬 스토리지에 데이터가 있으면 KV로 저장
    if (vacationStartDate && vacationEndDate) {
        console.log('📅 방학 기간 데이터를 KV로 마이그레이션 중...');
        await saveDataToStorage();
        console.log('✅ 로컬 스토리지에서 KV로 마이그레이션 완료!');
    } else {
        console.log('📝 로컬 스토리지에도 저장된 데이터가 없습니다.');
    }
}

// 로컬 스토리지에서 데이터 로드 (fallback)
function loadFromLocalStorage() {
    try {
        const savedVacation = JSON.parse(localStorage.getItem(getUserStorageKey('vacationPeriod')));
        if (savedVacation && savedVacation.start && savedVacation.end) {
            vacationStartDate = new Date(savedVacation.start + 'T00:00:00');
            vacationEndDate = new Date(savedVacation.end + 'T00:00:00');
        }
    } catch (e) {
        console.error("Error loading vacation period:", e);
    }

    try {
        const savedSchedules = localStorage.getItem(getUserStorageKey('schedules'));
        schedules = savedSchedules ? JSON.parse(savedSchedules) : [];
        
        // 기존 스케줄 데이터 검증 및 정리
        schedules = schedules.filter(schedule => {
            if (!schedule || typeof schedule !== 'object') {
                console.warn('Invalid schedule found and removed:', schedule);
        return false;
            }
            if (!schedule.startTime || !schedule.endTime || !schedule.category) {
                console.warn('Incomplete schedule found and removed:', schedule);
                return false;
            }
            
            // 기존 데이터 호환성을 위한 필드 초기화
            if (!schedule.selectedDays) {
                schedule.selectedDays = [];
            }
            
            // 새로운 스케줄 타입 필드 초기화
            if (!schedule.scheduleType) {
                schedule.scheduleType = 'repeat'; // 기본값: 반복
            }
            
            if (!schedule.repeatType) {
                schedule.repeatType = 'daily'; // 기본값: 매일
            }
            
            // 새로운 필드들 초기화
            if (schedule.specificDate === undefined) {
                schedule.specificDate = null;
            }
            if (schedule.specificWeekday === undefined) {
                schedule.specificWeekday = null;
            }
            if (schedule.periodStart === undefined) {
                schedule.periodStart = null;
            }
            if (schedule.periodEnd === undefined) {
                schedule.periodEnd = null;
            }
            
            return true;
        });
        
        // 정리된 스케줄 다시 저장
        localStorage.setItem(getUserStorageKey('schedules'), JSON.stringify(schedules));
        
    } catch (e) {
        console.error("Error loading schedules:", e);
        schedules = [];
        localStorage.removeItem('schedules'); // 손상된 데이터 제거
    }

    try {
        const savedStudyRecords = localStorage.getItem(getUserStorageKey('studyRecords'));
        studyRecords = savedStudyRecords ? JSON.parse(savedStudyRecords) : {};
    } catch (e) {
        console.error("Error loading study records:", e);
        studyRecords = {};
        localStorage.removeItem(getUserStorageKey('studyRecords')); // 손상된 데이터 제거
    }

    try {
        const savedCompletedSchedules = localStorage.getItem(getUserStorageKey('completedSchedules'));
        completedSchedules = savedCompletedSchedules ? JSON.parse(savedCompletedSchedules) : {};
    } catch (e) {
        console.error("Error loading completed schedules:", e);
        completedSchedules = {};
        localStorage.removeItem('completedSchedules'); // 손상된 데이터 제거
    }
}

async function saveDataToStorage() {
    // 로컬 스토리지에도 저장 (백업용)
    if (vacationStartDate && vacationEndDate) {
        localStorage.setItem(getUserStorageKey('vacationPeriod'), JSON.stringify({
            start: toYYYYMMDD(vacationStartDate),
            end: toYYYYMMDD(vacationEndDate)
        }));
    }
    
    localStorage.setItem(getUserStorageKey('schedules'), JSON.stringify(schedules));
    localStorage.setItem(getUserStorageKey('studyRecords'), JSON.stringify(studyRecords));
    localStorage.setItem(getUserStorageKey('completedSchedules'), JSON.stringify(completedSchedules));
    
    // KV 데이터베이스에 저장
    if (currentUser) {
        try {
            // 각 데이터 타입별로 저장
            const dataToSave = {
                vacationPeriod: vacationStartDate && vacationEndDate ? {
                    start: toYYYYMMDD(vacationStartDate),
                    end: toYYYYMMDD(vacationEndDate)
                } : null,
                schedules: schedules,
                studyRecords: studyRecords,
                completedSchedules: completedSchedules
            };
            
            for (const [dataType, data] of Object.entries(dataToSave)) {
                if (data !== null) {
                    const response = await fetch(`/api/user/data/${dataType}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    });
                    
                    if (!response.ok) {
                        console.error(`${dataType} 저장 실패:`, response.status);
                    }
                }
            }
            
            console.log('KV 데이터베이스에 데이터 저장 완료');
        } catch (error) {
            console.error('KV 저장 오류:', error);
        }
    }
}

// 스케줄 생성 함수
function generateSchedulesByDate() {
    schedulesByDate = {};
    
    if (!vacationStartDate || !vacationEndDate) return;
    
    // 등록된 스케줄들을 날짜별로 배치
    schedules.forEach(schedule => {
        if (!schedule || !schedule.startTime || !schedule.endTime) {
            console.warn('Invalid schedule found:', schedule);
        return;
    }
    
        for (let d = new Date(vacationStartDate); d <= vacationEndDate; d.setDate(d.getDate() + 1)) {
            if (shouldIncludeSchedule(schedule, d)) {
                const dateKey = toYYYYMMDD(d);
                if (!schedulesByDate[dateKey]) {
                    schedulesByDate[dateKey] = [];
                }
                schedulesByDate[dateKey].push({
                    ...schedule,
                    date: dateKey
                });
            }
        }
    });
    
    // 각 날짜에 순공 가능 시간대 추가
    for (let d = new Date(vacationStartDate); d <= vacationEndDate; d.setDate(d.getDate() + 1)) {
        const dateKey = toYYYYMMDD(d);
        addStudyTimeSlots(dateKey);
    }
}

function shouldIncludeSchedule(schedule, date) {
    const dayOfWeek = date.getDay();
    const dateString = toYYYYMMDD(date);
    
    // 스케줄 타입에 따른 처리
    if (schedule.scheduleType === 'specific') {
        // 지정 타입
        if (schedule.specificDate) {
            return dateString === schedule.specificDate;
        } else if (schedule.specificWeekday !== null) {
            return dayOfWeek === schedule.specificWeekday;
        }
        return false;
    } else if (schedule.scheduleType === 'period') {
        // 기간 타입
        if (schedule.periodStart && schedule.periodEnd) {
            return dateString >= schedule.periodStart && dateString <= schedule.periodEnd;
        }
        return false;
    } else {
        // 반복 타입 (기본값)
        
        // 반복 일정의 기간 제한 확인 (Date 객체로 정확한 비교)
        if (schedule.periodStart && schedule.periodEnd) {
            const scheduleDate = new Date(dateString + 'T00:00:00');
            const startDate = new Date(schedule.periodStart + 'T00:00:00');
            const endDate = new Date(schedule.periodEnd + 'T00:00:00');
            
            if (scheduleDate < startDate || scheduleDate > endDate) {
                return false;
            }
        }
        
        switch (schedule.repeatType) {
            case 'daily':
                return true;
            case 'weekdays':
                return dayOfWeek >= 1 && dayOfWeek <= 5;
            case 'weekends':
                return dayOfWeek === 0 || dayOfWeek === 6;
            case 'custom':
                return schedule.selectedDays && schedule.selectedDays.includes(dayOfWeek);
            default:
                return false;
        }
    }
}

function addStudyTimeSlots(dateKey) {
    if (!schedulesByDate[dateKey]) {
        schedulesByDate[dateKey] = [];
    }
    
    // 해당 날짜의 등록된 스케줄들 (순공시간 제외)
    const existingSchedules = schedulesByDate[dateKey].filter(s => !s.isStudySlot);
    
    // 기본 순공 가능 시간: 00:00~24:00 (24시간 = 1440분)
    let totalStudyMinutes = 24 * 60;
    
    console.log(`📅 ${dateKey} 순공시간 계산:`);
    console.log(`🕐 기본: 24시간 0분`);
    
    // 1️⃣ 먼저 전일에서 넘어온 취침시간 확인
    const [year, month, day] = dateKey.split('-').map(Number);
    const currentDate = new Date(year, month - 1, day);
    const previousDate = new Date(currentDate);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousDateKey = toYYYYMMDD(previousDate);
    
    // 전일 스케줄 중 자정을 넘는 취침시간 찾기
    const previousSchedules = schedulesByDate[previousDateKey] || [];
    previousSchedules.forEach(schedule => {
        if (schedule.category === '취침') {
            const startMinutes = timeToMinutes(schedule.startTime, false, schedule.category);
            const endMinutes = timeToMinutes(schedule.endTime, true, schedule.category);
            
            if (endMinutes < startMinutes) {
                // 자정을 넘는 취침시간 → 당일 새벽 부분 차감
                const morningMinutes = endMinutes + 60; // 기상 후 1시간 포함
                totalStudyMinutes -= morningMinutes;
                console.log(`😴 전일 취침(새벽): -${formatHoursMinutes(morningMinutes)} (00:00-${schedule.endTime} + 기상후 1시간)`);
            }
        }
    });
    
    // 2️⃣ 당일 스케줄들 차감
    let scheduleMinutes = 0;
    existingSchedules.forEach(schedule => {
        const start = timeToMinutes(schedule.startTime, false, schedule.category);
        const end = timeToMinutes(schedule.endTime, true, schedule.category);
        
        if (schedule.category === '취침') {
            // 취침: 취침 전 1시간 + 취침시간 + 기상 후 1시간
            if (end < start) {
                // 다음날로 넘어가는 취침 → 당일 밤 부분만
                const nightMinutes = (24 * 60 - start) + 60; // 취침 전 1시간 포함
                scheduleMinutes = nightMinutes;
                console.log(`😴 ${schedule.title || schedule.category}: -${formatHoursMinutes(scheduleMinutes)} (${schedule.startTime}-24:00 + 취침전 1시간)`);
            } else {
                // 같은 날 취침 (드문 경우)
                const sleepMinutes = end - start;
                const bufferMinutes = 120; // 앞뒤 1시간씩
                scheduleMinutes = sleepMinutes + bufferMinutes;
                console.log(`😴 ${schedule.title || schedule.category}: -${formatHoursMinutes(scheduleMinutes)} (${schedule.startTime}-${schedule.endTime} + 앞뒤 각 1시간)`);
            }
        } else if (schedule.category === '학원/과외' || schedule.category === '학원') {
            // 학원/과외: 이동시간 앞뒤 1시간씩 포함
            const classMinutes = end - start;
            const bufferMinutes = 120; // 앞뒤 1시간씩
            scheduleMinutes = classMinutes + bufferMinutes;
            const emoji = getScheduleEmoji(schedule.category);
            console.log(`${emoji} ${schedule.title || schedule.category}: -${formatHoursMinutes(scheduleMinutes)} (이동시간 포함: ${schedule.startTime}-${schedule.endTime} + 앞뒤 각 1시간)`);
        } else {
            // 일반 스케줄: 전체 시간 차감 (버퍼 없음)
            scheduleMinutes = end - start;
            const emoji = getScheduleEmoji(schedule.category);
            console.log(`${emoji} ${schedule.title || schedule.category}: -${formatHoursMinutes(scheduleMinutes)} (${schedule.startTime}-${schedule.endTime})`);
        }
        
        totalStudyMinutes -= scheduleMinutes;
    });
    
    // 최소 0분 보장
    totalStudyMinutes = Math.max(0, totalStudyMinutes);
    
    console.log(`✨ 결과: ${formatHoursMinutes(totalStudyMinutes)} ⭐`);
    
    // 실제 빈 시간대별로 순공 슬롯 생성
    const busyTimes = [];
    existingSchedules.forEach(schedule => {
        const start = timeToMinutes(schedule.startTime, false, schedule.category);
        let end = timeToMinutes(schedule.endTime, true, schedule.category);
        
        // 학원/과외의 경우 이동시간 포함
        if (schedule.category === '학원/과외' || schedule.category === '학원') {
            busyTimes.push({
                start: Math.max(0, start - 60), // 1시간 전
                end: Math.min(24 * 60, end + 60) // 1시간 후
            });
        } else if (schedule.category === '취침') {
            // 취침의 경우 전후 1시간 포함
            if (end < start) {
                // 다음날로 넘어가는 취침
                busyTimes.push({
                    start: Math.max(0, start - 60),
                    end: 24 * 60
                });
            } else {
                busyTimes.push({
                    start: Math.max(0, start - 60),
                    end: Math.min(24 * 60, end + 60)
                });
            }
        } else {
            busyTimes.push({ start, end });
        }
    });
    
    // 전일 취침 고려
    previousSchedules.forEach(schedule => {
        if (schedule.category === '취침') {
            const startMinutes = timeToMinutes(schedule.startTime, false, schedule.category);
            const endMinutes = timeToMinutes(schedule.endTime, true, schedule.category);
            
            if (endMinutes < startMinutes) {
                busyTimes.push({
                    start: 0,
                    end: Math.min(24 * 60, endMinutes + 60) // 기상 후 1시간 포함
                });
            }
        }
    });
    
    // 빈 시간대 계산하여 순공 슬롯 생성
    const studyPeriods = calculateStudyPeriods(busyTimes);
    
    studyPeriods.forEach((period, index) => {
        const startHour = Math.floor(period.start / 60);
        const startMinute = period.start % 60;
        const endHour = Math.floor(period.end / 60);
        const endMinute = period.end % 60;
        
        const startTime = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
        const endTime = `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`;
        const duration = period.end - period.start;
        
        schedulesByDate[dateKey].push({
            isStudySlot: true,
            startTime: startTime,
            endTime: endTime,
            duration: duration,
            category: '순공',
            title: `순공가능 ${formatMinutes(duration)}`
        });
    });
}

// 시간/분 형식으로 포맷팅
function formatHoursMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
        return `${hours}시간`;
    } else {
        return `${hours}시간 ${mins}분`;
    }
}

// 스케줄 카테고리별 이모지
function getScheduleEmoji(category) {
    const emojiMap = {
        '학원': '🏫',
        '학원/과외': '🏫',
        '자택과외': '🏠',
        '식사': '🍽️',
        '운동': '💪',
        '기타': '📋'
    };
    return emojiMap[category] || '📅';
}

function timeToMinutes(timeStr, isEndTime = false, category = null, startTimeStr = null) {
    if (!timeStr || typeof timeStr !== 'string') {
        console.error('Invalid time string:', timeStr);
        return 0;
    }
    const [hours, minutes] = timeStr.split(':').map(Number);
    let totalMinutes = hours * 60 + minutes;
    
    // 취침 시간의 종료 시간이 시작 시간보다 작으면 다음 날로 처리
    if (category === '취침' && isEndTime && startTimeStr) {
        const [startHours] = startTimeStr.split(':').map(Number);
        const startMinutes = startHours * 60 + parseInt(startTimeStr.split(':')[1]);
        
        // 종료 시간이 시작 시간보다 작으면 다음 날로 간주
        if (totalMinutes <= startMinutes) {
            totalMinutes += 24 * 60;
        }
    }
    
    return totalMinutes;
}

function minutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

function calculateStudyPeriods(busyTimes) {
    const dayStart = 0 * 60; // 00:00 (24시간 기준)
    const dayEnd = 24 * 60; // 24:00
    
    // 🐛 디버그: 바쁜 시간들 확인
    console.log('🔍 바쁜 시간들:', busyTimes.map(bt => ({ 
        start: Math.floor(bt.start/60) + ':' + String(bt.start%60).padStart(2,'0'), 
        end: Math.floor(bt.end/60) + ':' + String(bt.end%60).padStart(2,'0') 
    })));
    
    // 바쁜 시간들을 정렬
    busyTimes.sort((a, b) => a.start - b.start);
    
    const studyPeriods = [];
    let currentTime = dayStart;
    
    busyTimes.forEach(busy => {
        if (currentTime < busy.start) {
            const duration = busy.start - currentTime;
            if (duration >= 60) { // 1시간 이상인 경우만
                studyPeriods.push({
                    start: currentTime,
                    end: busy.start
                });
            }
        }
        currentTime = Math.max(currentTime, busy.end);
    });
    
    // 마지막 시간대 확인
    if (currentTime < dayEnd) {
        const duration = dayEnd - currentTime;
        if (duration >= 60) {
            studyPeriods.push({
                start: currentTime,
                end: dayEnd
            });
        }
    }
    
    // 🐛 디버그: 생성된 순공 시간들 확인
    console.log('📚 생성된 순공 시간들:', studyPeriods.map(sp => ({ 
        start: Math.floor(sp.start/60) + ':' + String(sp.start%60).padStart(2,'0'), 
        end: Math.floor(sp.end/60) + ':' + String(sp.end%60).padStart(2,'0'),
        duration: Math.floor((sp.end - sp.start)/60) + '시간 ' + ((sp.end - sp.start)%60) + '분'
    })));
    
    return studyPeriods;
}

// 캘린더 렌더링
function renderCalendar() {
    const container = document.getElementById('calendar');
    container.innerHTML = '';
    
    if (!vacationStartDate || !vacationEndDate) return;
    
    // 방학 기간의 날짜들만 표시하는 간단한 캘린더
    renderVacationCalendar(container);
}

function renderVacationCalendar(container) {
    const calendarDiv = document.createElement('div');
    calendarDiv.className = 'calendar-month';
    
    const title = document.createElement('h3');
    title.textContent = `방학 기간: ${formatDate(vacationStartDate)} ~ ${formatDate(vacationEndDate)}`;
    calendarDiv.appendChild(title);
    
    // 요일 헤더 추가
    const daysHeader = document.createElement('div');
    daysHeader.className = 'days-header';
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    dayNames.forEach(dayName => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        dayHeader.textContent = dayName;
        daysHeader.appendChild(dayHeader);
    });
    calendarDiv.appendChild(daysHeader);
    
    const calendarGrid = document.createElement('div');
    calendarGrid.className = 'calendar-grid';
    calendarGrid.style.display = 'grid';
    calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    calendarGrid.style.gap = '12px';
    
    // 방학 시작일의 요일 계산
    const startDayOfWeek = vacationStartDate.getDay(); // 0=일, 1=월, ..., 6=토
    
    // 방학 기간의 총 일수 계산
    const totalDays = Math.ceil((vacationEndDate - vacationStartDate) / (1000 * 60 * 60 * 24)) + 1;
    
    // 전체 그리드 크기 계산 (7일 단위로 맞춤)
    const totalCells = Math.ceil((startDayOfWeek + totalDays) / 7) * 7;
    
    // 그리드 셀 생성
    for (let i = 0; i < totalCells; i++) {
        const dayCell = document.createElement('div');
        
        // 방학 시작 전 빈 칸
        if (i < startDayOfWeek) {
            dayCell.className = 'day-cell disabled';
            calendarGrid.appendChild(dayCell);
            continue;
        }
        
        // 방학 기간 이후 빈 칸
        const dayIndex = i - startDayOfWeek;
        if (dayIndex >= totalDays) {
            dayCell.className = 'day-cell disabled';
            calendarGrid.appendChild(dayCell);
            continue;
        }
        
        // 방학 기간 내 날짜
        const currentDate = new Date(vacationStartDate);
        currentDate.setDate(vacationStartDate.getDate() + dayIndex);
        const dateKey = toYYYYMMDD(currentDate);
        
        dayCell.className = 'day-cell';
        
        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = currentDate.getDate();
        dayCell.appendChild(dayNumber);
        
        const schedulesContainer = document.createElement('div');
        schedulesContainer.className = 'schedules-container';
        
        // 해당 날짜의 스케줄들을 시간순으로 정렬하여 표시
        const daySchedules = schedulesByDate[dateKey] || [];
        
        // 시간순으로 정렬
        const sortedSchedules = daySchedules.sort((a, b) => {
            const aTime = a.startTime || '00:00';
            const bTime = b.startTime || '00:00';
            
            const [aHours, aMinutes] = aTime.split(':').map(Number);
            const [bHours, bMinutes] = bTime.split(':').map(Number);
            
            const aStartMinutes = aHours * 60 + aMinutes;
            const bStartMinutes = bHours * 60 + bMinutes;
            
            return aStartMinutes - bStartMinutes;
        });
        
        sortedSchedules.forEach(schedule => {
            const scheduleItem = document.createElement('div');
            let className = 'schedule-item ';
            
            if (schedule.isStudySlot) {
                className += 'study-slot';
            } else {
                className += schedule.category;
                
                // 완수 상태 확인
                const isCompleted = completedSchedules[dateKey] && completedSchedules[dateKey][schedule.id];
                if (isCompleted) {
                    className += ' completed';
                }
            }
            
            scheduleItem.className = className;
            
            // 스케줄 내용 표시
            const titleText = schedule.title || schedule.category;
            scheduleItem.textContent = titleText;
            
            schedulesContainer.appendChild(scheduleItem);
        });
        
        dayCell.appendChild(schedulesContainer);
        
        // 실제 순공시간만 표시 (순공가능시간 표시 제거)
        const dayStudyRecord = studyRecords[dateKey] || {};
        const totalStudyMinutes = Object.values(dayStudyRecord).reduce((sum, record) => {
            return sum + (record.minutes || 0);
        }, 0);
        
        if (totalStudyMinutes > 0) {
            const studyTimeDisplay = document.createElement('div');
            studyTimeDisplay.className = 'daily-study-time';
            studyTimeDisplay.textContent = `실제순공: ${formatMinutes(totalStudyMinutes)}`;
            dayCell.appendChild(studyTimeDisplay);
        }
        
        // 클릭 이벤트
        dayCell.addEventListener('click', () => showDayModal(dateKey, daySchedules));
        
        calendarGrid.appendChild(dayCell);
    }
    
    calendarDiv.appendChild(calendarGrid);
    container.appendChild(calendarDiv);
}

// 모달 관리
function showDayModal(dateKey, daySchedules) {
    const modal = document.getElementById('day-summary-modal');
    const title = document.getElementById('day-summary-title');
    const content = document.getElementById('day-summary-content');
    
    // 시간대 이슈 방지를 위해 명시적으로 로컬 날짜 생성
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    title.textContent = `${formatDate(date)} 요약`;
    
    // 통계 계산
    // 하루 총 시간 (24시간 = 1440분)
    const totalDayMinutes = 24 * 60;
    
    // 등록된 스케줄들의 총 시간 계산 (순공 시간 제외)
    let occupiedMinutes = 0;
    daySchedules.forEach(schedule => {
        if (!schedule.isStudySlot && schedule.startTime && schedule.endTime) {
            const startMinutes = timeToMinutes(schedule.startTime, false, schedule.category);
            const endMinutes = timeToMinutes(schedule.endTime, true, schedule.category);
            
            // 취침시간의 경우 다음날까지 이어지는 시간 계산
            if (schedule.category === '취침') {
                // 취침시간이 다음날로 넘어가는 경우 (예: 23:00 - 07:00)
                if (endMinutes > startMinutes) {
                    // 정상적인 시간 계산 (같은 날 내에서)
                    occupiedMinutes += (endMinutes - startMinutes);
                } else {
                    // 다음날로 넘어가는 경우 (예: 23:00 - 07:00)
                    // 23:00부터 24:00까지 + 00:00부터 07:00까지
                    occupiedMinutes += (24 * 60 - startMinutes) + endMinutes;
                }
            } else {
                occupiedMinutes += (endMinutes - startMinutes);
            }
        }
    });
    
    // 순공 가능 시간 = 실제 생성된 순공 슬롯들의 합계
    const availableStudySlots = daySchedules.filter(s => s.isStudySlot);
    const totalPossibleTime = availableStudySlots.reduce((sum, slot) => sum + (slot.duration || 0), 0);
    
    const actualStudyTime = studyRecords[dateKey] ? 
        Object.values(studyRecords[dateKey]).reduce((sum, record) => sum + (record.minutes || 0), 0) : 0;
    
    const efficiency = totalPossibleTime > 0 ? Math.round((actualStudyTime / totalPossibleTime) * 100) : 0;
    
    let modalHtml = `
        <div class="day-summary-stats">
            <div class="summary-stat">
                <div class="summary-stat-value">${formatMinutes(totalPossibleTime)}</div>
                <div class="summary-stat-label">순공 가능 시간</div>
        </div>
            <div class="summary-stat">
                <div class="summary-stat-value">${formatMinutes(actualStudyTime)}</div>
                <div class="summary-stat-label">실제 순공 시간</div>
        </div>
            <div class="summary-stat">
                <div class="summary-stat-value">${efficiency}%</div>
                <div class="summary-stat-label">시간 점유율</div>
            </div>
        </div>
    `;
    
    // 오늘의 스케줄
    const regularSchedules = daySchedules.filter(s => !s.isStudySlot);
    if (regularSchedules.length > 0) {
        modalHtml += `
            <div class="day-schedules">
                <h3>오늘의 스케줄</h3>
        `;
        
        regularSchedules.forEach(schedule => {
            const isCompleted = completedSchedules[dateKey] && completedSchedules[dateKey][schedule.id];
            const completeButtonText = isCompleted ? '완수취소' : '완수';
            const scheduleCardClass = isCompleted ? 'schedule-card completed' : 'schedule-card';
            
            modalHtml += `
                <div class="${scheduleCardClass}">
                    <div class="schedule-info">
                        <div class="schedule-title">${schedule.title || schedule.category}</div>
                        <div class="schedule-time">${schedule.startTime} - ${schedule.endTime}</div>
                    </div>
                    <div class="schedule-actions">
                        <button class="action-btn btn-complete" onclick="toggleScheduleComplete('${schedule.id}', '${dateKey}')">${completeButtonText}</button>
                        <button class="action-btn btn-edit" onclick="editSchedule('${schedule.id}')">수정</button>
                        <button class="action-btn btn-delete" onclick="deleteSchedule('${schedule.id}')">삭제</button>
                    </div>
                </div>
            `;
        });
        
        modalHtml += '</div>';
    }
    
    // 순공 가능 시간대
    const studySlots = daySchedules.filter(s => s.isStudySlot);
    if (studySlots.length > 0) {
        modalHtml += `
            <div class="study-time-slots">
                <h3>순공 가능 시간대 (클릭하여 입력)</h3>
        `;
        
        studySlots.forEach((slot, index) => {
            const slotId = `${dateKey}-${index}`;
            const recordedTime = studyRecords[dateKey] && studyRecords[dateKey][slotId] ? 
                studyRecords[dateKey][slotId].minutes : 0;
            
            modalHtml += `
                <div class="time-slot" onclick="showStudyTimeModal('${slotId}', '${dateKey}', '${slot.startTime}', '${slot.endTime}')">
                    <div class="slot-info">
                        ${slot.title} (${slot.startTime} - ${slot.endTime})
                </div>
                    <div class="slot-recorded">
                        ${recordedTime > 0 ? formatMinutes(recordedTime) : '미입력'}
                </div>
                </div>
            `;
        });
        
        modalHtml += '</div>';
    }
    
    // 하단 통계
    modalHtml += `
        <div class="day-summary-stats">
            <div class="summary-stat">
                <div class="summary-stat-value">${formatMinutes(totalPossibleTime)}</div>
                <div class="summary-stat-label">총 순공 가능 시간</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-value">${formatMinutes(actualStudyTime)}</div>
                <div class="summary-stat-label">기록된 순공 시간</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat-value">${efficiency}%</div>
                <div class="summary-stat-label">시간 집유율</div>
            </div>
        </div>
    `;
    
    content.innerHTML = modalHtml;
    openModal('day-summary-modal');
}

function showStudyTimeModal(slotId, dateKey, startTime, endTime) {
    const modal = document.getElementById('study-time-modal');
    const content = document.getElementById('study-time-content');
    
    const existingRecord = studyRecords[dateKey] && studyRecords[dateKey][slotId] ? 
        studyRecords[dateKey][slotId] : { minutes: 0, subject: '', notes: '' };
    
    const modalHtml = `
        <div class="study-time-form">
            <p><strong>시간대:</strong> ${startTime} - ${endTime}</p>
            
            <div class="form-group">
                <label for="study-minutes">실제 학습 시간 (분)</label>
                <input type="number" id="study-minutes" min="0" max="480" value="${existingRecord.minutes}" placeholder="예: 120">
            </div>
            
            <div class="form-group">
                <label for="study-subject">과목</label>
                <input type="text" id="study-subject" value="${existingRecord.subject}" placeholder="예: 수학, 영어">
            </div>
            
            <div class="form-group">
                <label for="study-notes">학습 내용/메모 (선택사항)</label>
                <textarea id="study-notes" rows="3" placeholder="예: 미적분 문제 풀이">${existingRecord.notes}</textarea>
            </div>
            
            <div class="modal-buttons">
                <button class="btn-cancel" onclick="closeStudyTimeModal()">취소</button>
                ${existingRecord.minutes > 0 ? `<button class="btn-delete" onclick="deleteStudyTime('${slotId}', '${dateKey}')">삭제</button>` : ''}
                <button class="btn-submit" onclick="saveStudyTime('${slotId}', '${dateKey}')">저장</button>
            </div>
        </div>
    `;
    
    content.innerHTML = modalHtml;
    openModal('study-time-modal');
}

function closeStudyTimeModal() {
    closeModal('study-time-modal');
}

function saveStudyTime(slotId, dateKey) {
    const minutes = parseInt(document.getElementById('study-minutes').value) || 0;
    const subject = document.getElementById('study-subject').value.trim();
    const notes = document.getElementById('study-notes').value.trim();
    
    // 해당 슬롯의 최대 시간 확인
    const daySchedules = schedulesByDate[dateKey] || [];
    const studySlot = daySchedules.find(s => s.isStudySlot && s.startTime + '-' + s.endTime === slotId);
    
    if (studySlot) {
        const maxMinutes = studySlot.duration || 0;
        if (minutes > maxMinutes) {
            showToast(`이 시간대의 최대 순공 가능 시간은 ${formatMinutes(maxMinutes)}입니다.`, 'error');
        return;
        }
    }
    
    if (!studyRecords[dateKey]) {
        studyRecords[dateKey] = {};
    }
    
    studyRecords[dateKey][slotId] = {
        minutes: minutes,
        subject: subject,
        notes: notes,
        timestamp: new Date().toISOString()
    };
    
    saveDataToStorage();
    closeStudyTimeModal();
    showToast('학습 시간이 저장되었습니다.', 'success');
    
    // 캘린더 다시 렌더링하여 일일 순공시간 표시 업데이트
    renderCalendar();
    
    // 이번주 주요일정 업데이트 (순공 가능 시간 → 실제 순공 시간 반영)
    updateWeeklySchedule();
    
    // 모달 새로고침
    closeModal('day-summary-modal');
}

function deleteStudyTime(slotId, dateKey) {
    if (confirm('이 학습 시간을 삭제하시겠습니까?')) {
        if (studyRecords[dateKey] && studyRecords[dateKey][slotId]) {
            delete studyRecords[dateKey][slotId];
            saveDataToStorage();
            showToast('학습 시간이 삭제되었습니다.', 'success');
            closeModal('day-summary-modal');
        }
    }
}

// 스케줄 완수 토글 함수
function toggleScheduleComplete(scheduleId, dateKey) {
    if (!completedSchedules[dateKey]) {
        completedSchedules[dateKey] = {};
    }
    
    // 완수 상태 토글
    if (completedSchedules[dateKey][scheduleId]) {
        delete completedSchedules[dateKey][scheduleId];
        showToast('완수 취소되었습니다.', 'info');
    } else {
        completedSchedules[dateKey][scheduleId] = true;
        showToast('완수 처리되었습니다!', 'success');
    }
    
    saveDataToStorage();
    
    // 캘린더 다시 렌더링
    renderCalendar();
    
    // 이번주 주요일정 업데이트
    updateWeeklySchedule();
    
    // 모달은 열린 상태로 유지하고 내용만 업데이트
    showDaySummary(dateKey);
}

// 일정 수정 함수
function editSchedule(scheduleId) {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule) {
        showToast('일정을 찾을 수 없습니다.', 'error');
        return;
    }
    
    // 날짜 상세 모달 닫기
    closeModal('day-summary-modal');
    
    // 스케줄 추가 모달 열기
    showScheduleModal();
    
    // 폼에 기존 데이터 채우기
    document.getElementById('schedule-subject').value = schedule.title || '';
    document.getElementById('schedule-category').value = schedule.category || '식사';
    
    // 시간 설정
    const [startHour, startMinute] = schedule.startTime.split(':');
    const [endHour, endMinute] = schedule.endTime.split(':');
    
    document.getElementById('start-hour').value = startHour;
    document.getElementById('start-minute').value = startMinute;
    document.getElementById('end-hour').value = endHour;
    document.getElementById('end-minute').value = endMinute;
    
    // 스케줄 타입 설정
    document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));
    const scheduleType = schedule.scheduleType || 'repeat';
    document.querySelector(`.type-btn[data-type="${scheduleType}"]`).classList.add('active');
    
    // 섹션 표시/숨김 설정
    document.getElementById('repeat-type-section').style.display = 'none';
    document.getElementById('custom-days-section').style.display = 'none';
    document.getElementById('specific-date-section').style.display = 'none';
    document.getElementById('period-section').style.display = 'none';
    
    if (scheduleType === 'repeat') {
        document.getElementById('repeat-type-section').style.display = 'block';
        
        // 반복 타입 설정
        document.querySelectorAll('.repeat-btn').forEach(btn => btn.classList.remove('active'));
        const repeatType = schedule.repeatType || 'daily';
        document.querySelector(`.repeat-btn[data-repeat="${repeatType}"]`).classList.add('active');
        
        // 요일별 선택 설정
        if (repeatType === 'custom') {
            document.getElementById('custom-days-section').style.display = 'block';
            
            // 기존 선택된 요일들 체크
            document.querySelectorAll('input[name="custom-days"]').forEach(checkbox => {
                checkbox.checked = schedule.selectedDays && schedule.selectedDays.includes(parseInt(checkbox.value));
            });
        }
        
        // 반복 기간 설정 불러오기
        if (schedule.periodStart) {
            document.getElementById('repeat-period-start').value = schedule.periodStart;
        }
        if (schedule.periodEnd) {
            document.getElementById('repeat-period-end').value = schedule.periodEnd;
        }
    } else if (scheduleType === 'specific') {
        document.getElementById('specific-date-section').style.display = 'block';
        
        if (schedule.specificDate) {
            document.getElementById('specific-date').value = schedule.specificDate;
        } else if (schedule.specificWeekday !== null) {
            document.querySelectorAll('.weekday-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelector(`.weekday-btn[data-day="${schedule.specificWeekday}"]`).classList.add('active');
        }
    } else if (scheduleType === 'period') {
        document.getElementById('period-section').style.display = 'block';
        
        if (schedule.periodStart) {
            document.getElementById('period-start').value = schedule.periodStart;
        }
        if (schedule.periodEnd) {
            document.getElementById('period-end').value = schedule.periodEnd;
        }
    }
    
    // 수정 모드 표시
    const modal = document.getElementById('schedule-modal');
    const modalTitle = modal.querySelector('.modal-header h2');
    modalTitle.textContent = '📝 일정 수정';
    
    // 폼 제출 시 수정 처리
    const form = document.getElementById('schedule-form');
    form.dataset.editMode = 'true';
    form.dataset.editId = scheduleId;
    
    // 제출 버튼 텍스트 변경
    const submitBtn = modal.querySelector('.btn-submit');
    submitBtn.textContent = '수정 완료';
}

// 일정 삭제 함수
function deleteSchedule(scheduleId) {
    if (confirm('이 일정을 삭제하시겠습니까?')) {
        const scheduleIndex = schedules.findIndex(s => s.id === scheduleId);
        if (scheduleIndex !== -1) {
            schedules.splice(scheduleIndex, 1);
            saveDataToStorage();
            
            // 화면 업데이트
            generateSchedulesByDate();
            renderCalendar();
            updateWeeklySchedule();
            updateWeeklyEvaluation();
            
            // 모달 닫기
            closeModal('day-summary-modal');
            
            showToast('일정이 삭제되었습니다.', 'success');
        }
    }
}

// 스케줄 추가 모달
function showScheduleModal() {
    const modal = document.getElementById('schedule-modal');
    
    // 시간 선택 옵션 생성
    populateTimeSelects();
    
    openModal('schedule-modal');
}

function populateTimeSelects() {
    const startHour = document.getElementById('start-hour');
    const startMinute = document.getElementById('start-minute');
    const endHour = document.getElementById('end-hour');
    const endMinute = document.getElementById('end-minute');
    
    // 시간 옵션 (0-23)
    [startHour, endHour].forEach(select => {
        select.innerHTML = '';
        for (let i = 0; i < 24; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `${i}시`;
            select.appendChild(option);
        }
    });
    
    // 분 옵션 (0, 30)
    [startMinute, endMinute].forEach(select => {
        select.innerHTML = '';
        [0, 30].forEach(minute => {
            const option = document.createElement('option');
            option.value = minute;
            option.textContent = `${minute.toString().padStart(2, '0')}분`;
            select.appendChild(option);
        });
    });
    
    // 기본값 설정
    startHour.value = '8';
    startMinute.value = '0';
    endHour.value = '9';
    endMinute.value = '0';
}

function closeScheduleModal() {
    const modal = document.getElementById('schedule-modal');
    const form = document.getElementById('schedule-form');
    
    // 수정 모드 초기화
    form.dataset.editMode = 'false';
    form.dataset.editId = '';
    
    // 모달 제목 초기화
    const modalTitle = modal.querySelector('.modal-header h2');
    modalTitle.textContent = '📝 새 스케줄 추가';
    
    // 제출 버튼 텍스트 초기화
    const submitBtn = modal.querySelector('.btn-submit');
    submitBtn.textContent = '+ 이 스케줄 추가!';
    
    closeModal('schedule-modal');
}

function resetScheduleForm() {
    // 폼 필드 초기화
    document.getElementById('schedule-subject').value = '';
    document.getElementById('schedule-category').value = '식사';
    
    // 스케줄 타입 초기화 (반복이 기본)
    document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('.type-btn[data-type="repeat"]').classList.add('active');
    
    // 반복 타입 초기화 (요일별이 기본)
    document.querySelectorAll('.repeat-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('.repeat-btn[data-repeat="custom"]').classList.add('active');
    
    // 섹션 표시/숨김 초기화
    document.getElementById('repeat-type-section').style.display = 'block';
    document.getElementById('custom-days-section').style.display = 'block';
    document.getElementById('specific-date-section').style.display = 'none';
    document.getElementById('period-section').style.display = 'none';
    
    // 요일별 체크박스 초기화
    document.querySelectorAll('input[name="custom-days"]').forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // 지정 옵션 초기화
    document.getElementById('specific-date').value = '';
    document.querySelectorAll('.weekday-btn').forEach(btn => btn.classList.remove('active'));
    
    // 기간 옵션 초기화
    document.getElementById('period-start').value = '';
    document.getElementById('period-end').value = '';
    
    // 반복 기간 옵션 초기화
    document.getElementById('repeat-period-start').value = '';
    document.getElementById('repeat-period-end').value = '';
    
    // 시간 선택 초기화
    populateTimeSelects();
}

// 이벤트 핸들러
function handleVacationSetup(e) {
    e.preventDefault();
    
    const startDate = document.getElementById('vacation-start').value;
    const endDate = document.getElementById('vacation-end').value;
    
    if (!startDate || !endDate) {
        showToast('시작일과 종료일을 모두 선택해주세요.', 'error');
        return;
    }
    
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    
    if (start >= end) {
        showToast('종료일은 시작일보다 늦어야 합니다.', 'error');
        return;
    }
    
    vacationStartDate = start;
    vacationEndDate = end;
    
    saveDataToStorage();
    showPlannerScreen();
    showToast('방학 기간이 설정되었습니다.', 'success');
}

function handleScheduleSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const isEditMode = form.dataset.editMode === 'true';
    const editId = form.dataset.editId;
    
    const subject = document.getElementById('schedule-subject').value.trim();
    const category = document.getElementById('schedule-category').value;
    const startHour = parseInt(document.getElementById('start-hour').value);
    const startMinute = parseInt(document.getElementById('start-minute').value);
    const endHour = parseInt(document.getElementById('end-hour').value);
    const endMinute = parseInt(document.getElementById('end-minute').value);
    
    if (!subject) {
        showToast('과목/활동을 입력해주세요.', 'error');
        return;
    }
    
    const startTime = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
    const endTime = `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`;
    
    // 취침 시간의 경우 자정을 넘나드는 것을 허용
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    
    if (category === '취침') {
        // 취침 시간은 자정을 넘나드는 것을 허용 (예: 23:00-07:00)
        // 단, 시작 시간과 종료 시간이 같으면 안됨
        if (startMinutes === endMinutes) {
            showToast('시작 시간과 종료 시간이 같을 수 없습니다.', 'error');
            return;
        }
            } else {
        // 일반 스케줄은 같은 날 내에서만 가능
        if (startMinutes >= endMinutes) {
            showToast('종료 시간은 시작 시간보다 늦어야 합니다.', 'error');
            return;
        }
    }
    
    // 시간 충돌 검증 함수
    function checkTimeConflict(newStart, newEnd, existingSchedules, newCategory) {
        const newStartMinutes = timeToMinutes(newStart, false, newCategory);
        const newEndMinutes = timeToMinutes(newEnd, true, newCategory, newStart);
        
        for (const schedule of existingSchedules) {
            if (schedule.isStudySlot) continue; // 순공시간은 제외
            
            const existingStart = timeToMinutes(schedule.startTime, false, schedule.category);
            const existingEnd = timeToMinutes(schedule.endTime, true, schedule.category, schedule.startTime);
            
            let blockedStart = existingStart;
            let blockedEnd = existingEnd;
            
            // 학원/과외와 취침의 경우 앞뒤 시간도 차단
            if (schedule.category === '학원/과외' || schedule.category === '학원') {
                blockedStart = Math.max(0, existingStart - 60);
                blockedEnd = Math.min(24 * 60, existingEnd + 60);
            } else if (schedule.category === '취침') {
                // 취침 시간이 자정을 넘나드는 경우 특별 처리
                if (existingEnd > 24 * 60) {
                    // 첫 번째 블록: 취침 전부터 자정까지
                    const firstBlockStart = Math.max(0, existingStart - 60);
                    const firstBlockEnd = 24 * 60;
                    
                    // 두 번째 블록: 자정부터 기상 후까지
                    const secondBlockStart = 0;
                    const secondBlockEnd = Math.min(24 * 60, (existingEnd - 24 * 60) + 60);
                    
                    // 새 스케줄이 두 블록 중 하나라도 겹치는지 확인
                    const conflictFirst = (newStartMinutes < firstBlockEnd && newEndMinutes > firstBlockStart);
                    const conflictSecond = (newStartMinutes < secondBlockEnd && newEndMinutes > secondBlockStart);
                    
                    if (conflictFirst || conflictSecond) {
                        return {
                            conflict: true,
                            message: `취침 시간(${schedule.startTime}-${schedule.endTime})의 앞뒤 1시간은 등록할 수 없습니다.`
                        };
                    }
                    continue; // 이 스케줄은 이미 처리했으므로 다음으로
                } else {
                    blockedStart = Math.max(0, existingStart - 60);
                    blockedEnd = Math.min(24 * 60, existingEnd + 60);
                }
            }
            
            // 시간 충돌 확인
            if (newStartMinutes < blockedEnd && newEndMinutes > blockedStart) {
                return {
                    conflict: true,
                    message: (schedule.category === '학원/과외' || schedule.category === '학원') ? 
                        `학원/과외 시간(${schedule.startTime}-${schedule.endTime})의 앞뒤 1시간은 등록할 수 없습니다.` :
                        schedule.category === '취침' ?
                        `취침 시간(${schedule.startTime}-${schedule.endTime})의 앞뒤 1시간은 등록할 수 없습니다.` :
                        `기존 스케줄(${schedule.startTime}-${schedule.endTime})과 시간이 겹칩니다.`
                };
            }
        }
        return { conflict: false };
    }
    
    // 현재 선택된 스케줄 타입 확인
    const activeTypeBtn = document.querySelector('.type-btn.active');
    const scheduleType = activeTypeBtn ? activeTypeBtn.dataset.type : 'repeat';
    
    let repeatType = 'daily';
    let selectedDays = [];
    let specificDate = null;
    let specificWeekday = null;
    let periodStart = null;
    let periodEnd = null;
    
    if (scheduleType === 'repeat') {
        // 반복 타입 처리
        const activeRepeatBtn = document.querySelector('.repeat-btn.active');
        repeatType = activeRepeatBtn ? activeRepeatBtn.dataset.repeat : 'custom';
        
        // 요일별 선택된 요일들 확인
        if (repeatType === 'custom') {
            const checkedDays = document.querySelectorAll('input[name="custom-days"]:checked');
            selectedDays = Array.from(checkedDays).map(checkbox => parseInt(checkbox.value));
            
            if (selectedDays.length === 0) {
                showToast('요일별 반복을 선택했을 때는 최소 하나의 요일을 선택해야 합니다.', 'error');
                return;
            }
        }
        
        // 반복 일정의 기간 설정 처리
        const repeatStartValue = document.getElementById('repeat-period-start').value;
        const repeatEndValue = document.getElementById('repeat-period-end').value;
        
        if (repeatStartValue && repeatEndValue) {
            if (new Date(repeatStartValue) > new Date(repeatEndValue)) {
                showToast('종료 날짜는 시작 날짜보다 늦어야 합니다.', 'error');
        return;
    }
            periodStart = repeatStartValue;
            periodEnd = repeatEndValue;
        }
    } else if (scheduleType === 'specific') {
        // 지정 타입 처리
        const dateValue = document.getElementById('specific-date').value;
        const activeWeekdayBtn = document.querySelector('.weekday-btn.active');
        
        if (dateValue) {
            specificDate = dateValue;
        } else if (activeWeekdayBtn) {
            specificWeekday = parseInt(activeWeekdayBtn.dataset.day);
        } else {
            showToast('지정 스케줄을 선택했을 때는 날짜 또는 요일을 선택해야 합니다.', 'error');
            return;
        }
    } else if (scheduleType === 'period') {
        // 기간 타입 처리
        const startValue = document.getElementById('period-start').value;
        const endValue = document.getElementById('period-end').value;
        
        if (!startValue || !endValue) {
            showToast('기간 스케줄을 선택했을 때는 시작 날짜와 종료 날짜를 모두 선택해야 합니다.', 'error');
        return;
    }
    
        periodStart = startValue;
        periodEnd = endValue;

        if (new Date(periodStart) > new Date(periodEnd)) {
            showToast('종료 날짜는 시작 날짜보다 늦어야 합니다.', 'error');
        return;
        }
    }

    const newSchedule = {
        id: isEditMode ? editId : Date.now().toString(),
        title: subject,
        category: category,
        startTime: startTime,
        endTime: endTime,
        scheduleType: scheduleType,
        repeatType: repeatType,
        selectedDays: selectedDays,
        specificDate: specificDate,
        specificWeekday: specificWeekday,
        periodStart: periodStart,
        periodEnd: periodEnd,
        createdAt: isEditMode ? schedules.find(s => s.id === editId)?.createdAt || new Date().toISOString() : new Date().toISOString()
    };
    
    // 방학 기간 동안 충돌 검증 수행
    let hasConflict = false;
    let conflictMessage = '';
    
    for (let date = new Date(vacationStartDate); date <= vacationEndDate; date.setDate(date.getDate() + 1)) {
        if (shouldIncludeSchedule(newSchedule, date)) {
            const dateKey = toYYYYMMDD(date);
            let existingSchedules = schedulesByDate[dateKey] || [];
            
            // 수정 모드일 때는 현재 수정 중인 스케줄을 제외하고 충돌 검증
            if (isEditMode && editId) {
                existingSchedules = existingSchedules.filter(schedule => schedule.id !== editId);
            }
            
            const conflict = checkTimeConflict(startTime, endTime, existingSchedules, category);
            
            if (conflict.conflict) {
                hasConflict = true;
                conflictMessage = conflict.message;
                break;
            }
        }
    }
    
    if (hasConflict) {
        showToast(conflictMessage, 'error');
        return;
    }

    if (isEditMode) {
        // 수정 모드
        const scheduleIndex = schedules.findIndex(s => s.id === editId);
        if (scheduleIndex !== -1) {
            schedules[scheduleIndex] = newSchedule;
            showToast('일정이 수정되었습니다.', 'success');
        }
    } else {
        // 추가 모드
        schedules.push(newSchedule);
        showToast('스케줄이 추가되었습니다.', 'success');
    }
    
    saveDataToStorage();
    
    generateSchedulesByDate();
    renderCalendar();
    updateWeeklySchedule();
    updateWeeklyEvaluation();
    
    closeScheduleModal();
    resetScheduleForm();
}

function handleResetPeriod() {
    if (confirm('방학 기간을 재설정하시겠습니까? 기존 스케줄은 유지됩니다.')) {
        // 방학 기간 초기화
        vacationStartDate = null;
        vacationEndDate = null;
        schedulesByDate = {};
        
        // 로컬 스토리지에서 방학 기간 삭제
        localStorage.removeItem('vacationPeriod');
        
        // 입력 필드 초기화
        document.getElementById('vacation-start').value = '';
        document.getElementById('vacation-end').value = '';
        
        showSetupScreen();
    }
}

// 유틸리티 함수
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// 모달 관리 유틸리티 함수
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
        document.body.classList.add('modal-open');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

// 마크다운을 HTML로 변환하는 함수
function markdownToHtml(text) {
    if (!text) return '';
    
    return text
        // 볼드 텍스트 (**텍스트** 또는 __텍스트__)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.*?)__/g, '<strong>$1</strong>')
        
        // 이탤릭 텍스트 (*텍스트* 또는 _텍스트_)
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/_(.*?)_/g, '<em>$1</em>')
        
        // 헤딩 (### 텍스트)
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        
        // 리스트 항목 (- 텍스트)
        .replace(/^- (.*$)/gm, '<li>$1</li>')
        .replace(/^(\d+)\. (.*$)/gm, '<li>$2</li>')
        
        // 줄바꿈을 <br>로 변환
        .replace(/\n/g, '<br>')
        
        // 연속된 <li> 태그를 <ul>로 감싸기
        .replace(/(<li>.*?<\/li>)(<br>)*(<li>.*?<\/li>)/g, function(match, ...groups) {
            // 연속된 li 태그들을 찾아서 ul로 감싸기
            const items = match.split('<br>').filter(item => item.includes('<li>'));
            return '<ul>' + items.join('') + '</ul>';
        })
        
        // 남은 단일 li 태그들도 ul로 감싸기
        .replace(/(<li>.*?<\/li>)/g, '<ul>$1</ul>')
        
        // 중복된 ul 태그 정리
        .replace(/<\/ul><br><ul>/g, '')
        .replace(/<\/ul><ul>/g, '');
}

// 초기화
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 플래너 페이지 초기화 시작');
    console.log('📍 현재 URL:', window.location.href);
    console.log('🕒 현재 시간:', new Date().toISOString());
    
    // URL 파라미터 확인 (OAuth 콜백에서 타임스탬프가 있는지)
    const urlParams = new URLSearchParams(window.location.search);
    const timestamp = urlParams.get('t');
    if (timestamp) {
        console.log('⏰ OAuth 콜백 타임스탬프 감지:', timestamp);
        // URL 정리 (뒤로가기 시 깔끔하게)
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    }
    
    // 세션 확인을 먼저 수행
    console.log('🔍 세션 확인 중...');
    const isAuthenticated = await checkSession();
    if (!isAuthenticated) {
        console.log('❌ 세션이 유효하지 않습니다. 로그인 페이지로 이동합니다.');
        window.location.href = '/login';
        return;
    }
    console.log('✅ 세션 확인 완료');
    
    console.log('📊 데이터 로딩 시작...');
    await loadDataFromStorage();
    console.log('✅ 데이터 로딩 완료');
    
    // 방학 기간이 설정되어 있으면 플래너 화면으로
    if (vacationStartDate && vacationEndDate) {
        console.log('📅 방학 기간 설정됨, 플래너 화면 표시');
        showPlannerScreen();
    } else {
        console.log('⚙️ 방학 기간 미설정, 설정 화면 표시');
        showSetupScreen();
    }
    console.log(' 플래너 페이지 초기화 완료');
    
    // 이벤트 리스너 등록
    document.getElementById('vacation-setup-form').addEventListener('submit', handleVacationSetup);
    document.getElementById('schedule-form').addEventListener('submit', handleScheduleSubmit);
    document.getElementById('reset-period-btn').addEventListener('click', handleResetPeriod);
    
    // 버튼 이벤트
    document.getElementById('schedule-register-btn').addEventListener('click', showScheduleModal);
    document.getElementById('mbti-coaching-btn').addEventListener('click', showMBTICoaching);
    document.getElementById('share-calendar-btn').addEventListener('click', showShareModal);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    
    // 모달 닫기 이벤트
    document.getElementById('schedule-modal-close').addEventListener('click', closeScheduleModal);
    document.getElementById('schedule-cancel-btn').addEventListener('click', closeScheduleModal); // 취소 버튼 추가
    document.getElementById('day-modal-close').addEventListener('click', () => {
        closeModal('day-summary-modal');
    });
    document.getElementById('study-modal-close').addEventListener('click', closeStudyTimeModal);
    document.getElementById('mbti-modal-close').addEventListener('click', closeMBTICoachingModal);
    document.getElementById('share-modal-close').addEventListener('click', closeShareModal);
    
    // 모달 외부 클릭 시 닫기
    window.addEventListener('click', (event) => {
        const modals = ['schedule-modal', 'day-summary-modal', 'study-time-modal', 'mbti-coaching-modal', 'share-modal'];
        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (event.target === modal) {
                closeModal(modalId);
            }
        });
    });
    document.getElementById('mbti-cancel-btn').addEventListener('click', closeMBTICoachingModal);
    
    // 스케줄 타입 버튼 이벤트
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // 각 섹션 표시/숨김
            const repeatSection = document.getElementById('repeat-type-section');
            const customDaysSection = document.getElementById('custom-days-section');
            const specificSection = document.getElementById('specific-date-section');
            const periodSection = document.getElementById('period-section');
            
            // 모든 섹션 숨기기
            repeatSection.style.display = 'none';
            customDaysSection.style.display = 'none';
            specificSection.style.display = 'none';
            periodSection.style.display = 'none';
            
            // 선택된 타입에 따라 해당 섹션 표시
            const selectedType = this.dataset.type;
            if (selectedType === 'repeat') {
                repeatSection.style.display = 'block';
                // 반복 타입이 요일별인 경우 요일 선택 섹션도 표시
                const activeRepeatBtn = document.querySelector('.repeat-btn.active');
                if (activeRepeatBtn && activeRepeatBtn.dataset.repeat === 'custom') {
                    customDaysSection.style.display = 'block';
                }
            } else if (selectedType === 'specific') {
                specificSection.style.display = 'block';
            } else if (selectedType === 'period') {
                periodSection.style.display = 'block';
            }
        });
    });
    
    document.querySelectorAll('.repeat-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.repeat-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // 요일별 선택 섹션 표시/숨김
            const customDaysSection = document.getElementById('custom-days-section');
            if (this.dataset.repeat === 'custom') {
                customDaysSection.style.display = 'block';
            } else {
                customDaysSection.style.display = 'none';
            }
        });
    });
    
    // 지정 옵션의 요일 버튼 이벤트
    document.querySelectorAll('.weekday-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.weekday-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // 날짜 선택 초기화
            document.getElementById('specific-date').value = '';
        });
    });
    
    // 지정 옵션의 날짜 선택 이벤트
    document.getElementById('specific-date').addEventListener('change', function() {
        if (this.value) {
            // 요일 버튼 선택 해제
            document.querySelectorAll('.weekday-btn').forEach(b => b.classList.remove('active'));
        }
    });
    
    // 모달 외부 클릭 시 닫기
    window.addEventListener('click', function(event) {
        const modals = ['schedule-modal', 'day-summary-modal', 'study-time-modal', 'mbti-coaching-modal'];
        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
});

// MBTI 학습 코칭 기능
function showMBTICoaching() {
    const modal = document.getElementById('mbti-coaching-modal');
    const resultContainer = document.getElementById('mbti-coaching-result');
    
    // 결과 초기화
    resultContainer.style.display = 'none';
    resultContainer.innerHTML = '';
    
    // MBTI 버튼 이벤트 리스너 추가
    setupMBTIButtons();
    
    openModal('mbti-coaching-modal');
}

function setupMBTIButtons() {
    const mbtiButtons = document.querySelectorAll('.mbti-btn');
    const selectedMbtiDiv = document.getElementById('selected-mbti');
    const selectedMbtiText = document.getElementById('selected-mbti-text');
    const coachingBtn = document.getElementById('mbti-get-coaching-btn');
    let selectedMbti = null;
    
    // 기존 이벤트 리스너 제거 (중복 방지)
    const newCoachingBtn = coachingBtn.cloneNode(true);
    coachingBtn.parentNode.replaceChild(newCoachingBtn, coachingBtn);
    
    mbtiButtons.forEach(button => {
        button.addEventListener('click', function() {
            // 기존 선택 해제
            mbtiButtons.forEach(btn => btn.classList.remove('selected'));
            
            // 현재 버튼 선택
            this.classList.add('selected');
            selectedMbti = this.dataset.mbti;
            
            // 선택된 MBTI 표시
            const mbtiType = this.querySelector('.mbti-type').textContent;
            const mbtiName = this.querySelector('.mbti-name').textContent;
            selectedMbtiText.textContent = `${mbtiType} - ${mbtiName}`;
            selectedMbtiDiv.style.display = 'block';
        });
    });
    
    // 코칭 받기 버튼 이벤트 (새로운 버튼에 등록)
    document.getElementById('mbti-get-coaching-btn').addEventListener('click', function() {
        if (selectedMbti) {
            getMBTICoaching(selectedMbti);
    } else {
            showToast('MBTI 타입을 선택해주세요.', 'error');
        }
    });
}

function closeMBTICoachingModal() {
    closeModal('mbti-coaching-modal');
}

// MBTI 코칭 요청 함수
async function getMBTICoaching(mbtiType) {
    try {
        const resultContainer = document.getElementById('mbti-coaching-result');
        
        // 로딩 상태 표시
        resultContainer.innerHTML = `
            <div class="loading-container">
                <div class="loading-spinner"></div>
                <p>🧠 ${mbtiType} 맞춤 학습 코칭을 준비하고 있습니다...</p>
            </div>
        `;
        
        // 현재 학습 데이터 수집
        const studyData = {
            schedules: schedules || [],
            studyRecords: studyRecords || {},
            completedSchedules: completedSchedules || {},
            vacationPeriod: {
                start: vacationStartDate ? toYYYYMMDD(vacationStartDate) : null,
                end: vacationEndDate ? toYYYYMMDD(vacationEndDate) : null
            }
        };
        
        // 서버에 MBTI 코칭 요청
        const response = await fetch('/mbti-coaching', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mbtiType: mbtiType,
                studyData: studyData,
                currentSchedule: schedules
            })
        });
        
        if (!response.ok) {
            throw new Error('코칭 요청에 실패했습니다.');
        }
        
        const coaching = await response.json();
        
        // 코칭 결과 표시
        resultContainer.innerHTML = `
            <div class="coaching-result">
                <h3>🎯 ${coaching.title}</h3>
                <div class="coaching-content">
                    <div class="analysis-section">
                        <h4>📊 MBTI 학습 특성 분석</h4>
                        <p>${coaching.mbtiAnalysis}</p>
                    </div>
                    <div class="advice-section">
                        <h4>💡 맞춤 학습 조언</h4>
                        <p>${coaching.studyAdvice}</p>
                    </div>
                    <div class="methods-section">
                        <h4>📚 추천 학습 방법</h4>
                        <p>${coaching.studyMethods}</p>
                    </div>
                </div>
            </div>
        `;
        
    } catch (error) {
        console.error('MBTI 코칭 오류:', error);
        const resultContainer = document.getElementById('mbti-coaching-result');
        resultContainer.innerHTML = `
            <div class="error-message">
                <h4>⚠️ 오류 발생</h4>
                <p>코칭 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</p>
                <button onclick="getMBTICoaching('${mbtiType}')" class="retry-btn">다시 시도</button>
            </div>
        `;
    }
}

// 현재 플래너의 모든 데이터 수집
function collectCurrentPlannerData() {
    try {
        // 전역 변수에서 직접 데이터 수집
        const vacationPeriod = vacationStartDate && vacationEndDate ? {
            start: toYYYYMMDD(vacationStartDate),
            end: toYYYYMMDD(vacationEndDate)
        } : null;

        console.log('📊 수집된 데이터:', {
            vacationPeriod: !!vacationPeriod,
            schedulesCount: schedules.length,
            studyRecordsCount: Object.keys(studyRecords).length,
            completedCount: Object.keys(completedSchedules).length
        });
        
        return {
            vacationPeriod,
            schedules,
            studyRecords,
            completedSchedules,
            createdAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('데이터 수집 오류:', error);
        return null;
    }
}

// 에러 메시지 표시
function showErrorMessage(message) {
    const modal = document.getElementById('share-modal');
    const content = modal.querySelector('.modal-body');
    content.innerHTML = `
        <div class="share-content">
            <h3>⚠️ 오류 발생</h3>
            <p>${message}</p>
            <div class="error-actions">
                <button class="retry-btn" onclick="handleShareLinks()">
                    🔄 다시 시도
                </button>
                <button class="close-btn" onclick="closeShareModal()">
                    ❌ 닫기
                </button>
            </div>
        </div>
    `;
}

// 공유 모달 함수들
function showShareModal() {
    const modal = document.getElementById('share-modal');
    if (modal) {
        modal.style.display = 'block';
        document.body.classList.add('modal-open');
        handleShareLinks(); // 모달이 열릴 때 자동으로 공유 링크 생성 시도
    }
}

function closeShareModal() {
    const modal = document.getElementById('share-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

// 공유 링크 처리 함수
async function handleShareLinks() {
    try {
        const plannerData = collectCurrentPlannerData();
        if (!plannerData) {
            showErrorMessage('공유할 데이터가 없습니다.');
            return;
        }
        
        // 공유 링크 생성 로직 (서버 API 호출)
        const response = await fetch('/api/share/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(plannerData)
        });
        
        if (!response.ok) {
            throw new Error('공유 링크 생성에 실패했습니다.');
        }
        
        const result = await response.json();
        showShareLinks(result);
        
    } catch (error) {
        console.error('공유 처리 오류:', error);
        showErrorMessage('공유 링크 생성 중 오류가 발생했습니다.');
    }
}

function showShareLinks(shareData) {
    const modal = document.getElementById('share-modal');
    const content = modal.querySelector('.modal-body');
    
    // 서버에서 viewToken과 recordToken을 받아서 공유 URL 생성
    const baseUrl = window.location.origin;
    const viewUrl = `${baseUrl}/shared/view/${shareData.viewToken}`;
    const recordUrl = `${baseUrl}/shared/record/${shareData.recordToken}`;
    
    content.innerHTML = `
        <div class="share-content">
            <h3>📅 캘린더 공유</h3>
            
            <div class="share-section">
                <h4>👀 보기 전용 링크</h4>
                <p>캘린더를 조회만 할 수 있습니다</p>
                <div class="link-container">
                    <input type="text" class="share-link-input" value="${viewUrl}" readonly>
                    <button class="btn-copy" onclick="copyToClipboard('${viewUrl}')">복사</button>
                </div>
            </div>
            
            <div class="share-section">
                <h4>✏️ 실적 입력 가능 링크</h4>
                <p>순공 실적을 입력할 수 있습니다</p>
                <div class="link-container">
                    <input type="text" class="share-link-input" value="${recordUrl}" readonly>
                    <button class="btn-copy" onclick="copyToClipboard('${recordUrl}')">복사</button>
                </div>
            </div>
        </div>
    `;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('링크가 클립보드에 복사되었습니다!');
    }).catch(() => {
        alert('복사에 실패했습니다.');
    });
}

// 주간 평가 데이터 업데이트 함수
function updateWeeklyEvaluation() {
    const now = getCurrentKoreanDate(); // 한국 시간 기준으로 변경
    const weekRange = getWeekRange(now); // 현재 주 범위 사용
    
    let totalPlannedHours = 0;
    let totalCompletedHours = 0;
    let totalStudyDays = 0;
    let studyDaysWithRecords = 0;
    let elapsedDays = 0;
    
    // 현재 주 범위에서만 계산 (방학 기간과 교집합)
    // 하지만 경과일은 일요일부터 오늘까지만 계산
    const today = new Date(now);
    const endCalculationDate = today > new Date(weekRange.end) ? new Date(weekRange.end) : today;
    
    for (let d = new Date(weekRange.start); d <= endCalculationDate; d.setDate(d.getDate() + 1)) {
        const dateKey = toYYYYMMDD(d);
        
        // 방학 기간 내 날짜만 계산
        if (vacationStartDate && vacationEndDate) {
            const currentDate = new Date(dateKey + 'T00:00:00');
            if (currentDate < vacationStartDate || currentDate > vacationEndDate) {
                continue; // 방학 기간 외 날짜는 제외
            }
        }
        
        const daySchedules = schedulesByDate[dateKey] || [];
        const dayStudyRecord = studyRecords[dateKey] || {};
        
        elapsedDays++;
        
        // 계획된 학습 시간 계산
        let dayPlannedHours = 0;
        daySchedules.forEach(schedule => {
            if (schedule.isStudySlot) {
                dayPlannedHours += schedule.duration || 0;
            }
        });
        
        if (dayPlannedHours > 0) {
            totalStudyDays++;
            totalPlannedHours += dayPlannedHours;
            
            // 실제 완료된 학습 시간 계산
            const completedHours = Object.values(dayStudyRecord).reduce((sum, record) => {
                return sum + (record.minutes || 0);
            }, 0);
            
            if (completedHours > 0) {
                studyDaysWithRecords++;
                totalCompletedHours += completedHours;
            }
        }
    }
    
    // 달성률 계산 (이번주 기준)
    const achievementRate = totalPlannedHours > 0 ? 
        Math.round((totalCompletedHours / totalPlannedHours) * 100) : 0;
    
    // 평가 메시지 생성
    let evaluationMessage = '';
    if (achievementRate >= 80) {
        evaluationMessage = '🎉 훌륭합니다! 계획을 잘 지키고 있어요.';
    } else if (achievementRate >= 60) {
        evaluationMessage = '👍 좋은 성과입니다. 조금 더 노력해보세요.';
    } else if (achievementRate >= 40) {
        evaluationMessage = '⚠️ 계획 대비 부족합니다. 더 집중해보세요.';
    } else {
        evaluationMessage = '🚨 계획 실행이 많이 부족합니다. 계획을 재검토해보세요.';
    }
    
    // UI 업데이트
    const evaluationContainer = document.querySelector('.evaluation-box');
    if (evaluationContainer) {
        evaluationContainer.innerHTML = `
            <div class="evaluation-stats">
                <div class="eval-stat">
                    <span class="eval-label">경과일:</span>
                    <span class="eval-value">${elapsedDays}일</span>
                </div>
                <div class="eval-stat">
                    <span class="eval-label">계획 순공시간:</span>
                    <span class="eval-value">${formatMinutes(totalPlannedHours)}</span>
                </div>
                <div class="eval-stat">
                    <span class="eval-label">실제 순공시간:</span>
                    <span class="eval-value">${formatMinutes(totalCompletedHours)}</span>
                </div>
                <div class="eval-stat">
                    <span class="eval-label">달성률:</span>
                    <span class="eval-value">${achievementRate}%</span>
                </div>
            </div>
            <div class="evaluation-message">${evaluationMessage}</div>
        `;
    }
}

// 로그아웃 함수
function handleLogout() {
    if (confirm('정말 로그아웃하시겠습니까?')) {
        // 클라이언트 데이터 정리
        localStorage.clear();
        
        // 서버 세션 정리를 위해 로그아웃 API 호출
        window.location.href = '/logout';
    }
}
