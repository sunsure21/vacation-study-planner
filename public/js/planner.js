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
    return date.toISOString().split('T')[0];
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
            // 순공 슬롯이 없으면 기본 15시간 (09:00~24:00)
            totalStudySlotMinutes = 15 * 60; // 900분
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
        if (schedule.category === '취침' && !schedule.isStudySlot) {
            const start = timeToMinutes(schedule.startTime, false, schedule.category);
            const end = timeToMinutes(schedule.endTime, true, schedule.category);
            
            if (end > 24 * 60) {
                // 자정을 넘는 취침: 다음날(당일) 새벽 부분 차감
                const nextDayMinutes = end - 24 * 60;
                totalStudyMinutes -= nextDayMinutes;
                
                const endHour = schedule.endTime.split(':')[0].padStart(2,'0');
                const endMinute = schedule.endTime.split(':')[1];
                console.log(`😴 전일 취침(${schedule.title || '취침'}): -${formatHoursMinutes(nextDayMinutes)} (00:00-${endHour}:${endMinute})`);
            }
        }
    });
    
    // 2️⃣ 당일 등록된 스케줄들 처리
    existingSchedules.forEach(schedule => {
        if (!schedule.startTime || !schedule.endTime) {
            console.warn('Invalid schedule found:', schedule);
            return;
        }
        
        const start = timeToMinutes(schedule.startTime, false, schedule.category);
        const end = timeToMinutes(schedule.endTime, true, schedule.category);
        
        let scheduleMinutes = 0;
        
        if (schedule.category === '취침') {
            // 당일 취침시간 처리
            if (end > 24 * 60) {
                // 자정을 넘는 취침: 당일은 시작시간~24:00만 차감
                scheduleMinutes = 24 * 60 - start;
                console.log(`😴 당일 취침(${schedule.title || '취침'}): -${formatHoursMinutes(scheduleMinutes)} (${schedule.startTime}-24:00)`);
            } else {
                // 같은 날 취침: 전체 차감
                scheduleMinutes = end - start;
                console.log(`😴 당일 취침(${schedule.title || '취침'}): -${formatHoursMinutes(scheduleMinutes)} (${schedule.startTime}-${schedule.endTime})`);
            }
        } else {
            // 일반 스케줄: 전체 시간 차감
            scheduleMinutes = end - start;
            const emoji = getScheduleEmoji(schedule.category);
            console.log(`${emoji} ${schedule.title || schedule.category}: -${formatHoursMinutes(scheduleMinutes)} (${schedule.startTime}-${schedule.endTime})`);
        }
        
        totalStudyMinutes -= scheduleMinutes;
    });
    
    // 최소 0분 보장
    totalStudyMinutes = Math.max(0, totalStudyMinutes);
    
    console.log(`✨ 결과: ${formatHoursMinutes(totalStudyMinutes)} ⭐`);
    
    // 순공 가능 시간이 있으면 하나의 큰 슬롯으로 생성
    if (totalStudyMinutes > 0) {
        schedulesByDate[dateKey].push({
            isStudySlot: true,
            startTime: '00:00',
            endTime: '24:00',
            duration: totalStudyMinutes,
            category: '순공',
            title: `순공가능 ${formatMinutes(totalStudyMinutes)}`
        });
    }
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

function timeToMinutes(timeStr, isEndTime = false, category = null) {
    if (!timeStr || typeof timeStr !== 'string') {
        console.error('Invalid time string:', timeStr);
        return 0;
    }
    const [hours, minutes] = timeStr.split(':').map(Number);
    let totalMinutes = hours * 60 + minutes;
    
    // 취침 시간의 종료 시간이 시작 시간보다 작으면 다음 날로 처리
    if (category === '취침' && isEndTime) {
        // 종료 시간이 12시 이전이면 다음 날로 간주 (24시간 추가)
        if (hours < 12) {
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
    const dayStart = 9 * 60; // 9:00
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
        
        // 실제 순공시간 총량 표시
        const dayStudyRecord = studyRecords[dateKey] || {};
        const totalStudyMinutes = Object.values(dayStudyRecord).reduce((sum, record) => {
            return sum + (record.minutes || 0);
        }, 0);
        
        if (totalStudyMinutes > 0) {
            const studyTimeDisplay = document.createElement('div');
            studyTimeDisplay.className = 'daily-study-time';
            const hours = Math.floor(totalStudyMinutes / 60);
            const minutes = totalStudyMinutes % 60;
            studyTimeDisplay.textContent = hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
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
    
    // 모달 새로고침
    closeModal('day-summary-modal');
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
        const newEndMinutes = timeToMinutes(newEnd, true, newCategory);
        
        for (const schedule of existingSchedules) {
            if (schedule.isStudySlot) continue; // 순공시간은 제외
            
            const existingStart = timeToMinutes(schedule.startTime, false, schedule.category);
            const existingEnd = timeToMinutes(schedule.endTime, true, schedule.category);
            
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

async function getMBTICoaching(mbtiType) {
    const resultContainer = document.getElementById('mbti-coaching-result');
    
    if (!mbtiType) {
        showToast('MBTI 타입을 선택해주세요.', 'error');
        return;
    }

    // 로딩 표시
    resultContainer.style.display = 'block';
    resultContainer.innerHTML = `
        <div class="loading-spinner">
            <p>🧠 AI가 당신의 MBTI 타입을 분석하고 있습니다...</p>
                    </div>
                `;
    
    try {
        // 현재 학습 데이터 수집
        const studyData = {
            studyRecords: studyRecords,
            totalStudyTime: calculateTotalStudyTime(),
            recentActivity: getRecentStudyActivity()
        };
        
        const currentSchedule = {
            schedules: schedules,
            schedulesByDate: schedulesByDate,
            vacationPeriod: {
                start: vacationStartDate ? toYYYYMMDD(vacationStartDate) : null,
                end: vacationEndDate ? toYYYYMMDD(vacationEndDate) : null
            }
        };
        
        const response = await fetch('/mbti-coaching', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                mbtiType: mbtiType,
                studyData: studyData,
                currentSchedule: currentSchedule
            })
        });
        
        if (!response.ok) {
            throw new Error('서버 오류가 발생했습니다.');
        }
        
        const result = await response.json();
        
        // 결과 표시
        resultContainer.innerHTML = `
            <div class="mbti-recommendation-card">
                <div class="mbti-header">
                    <h4>${mbtiType} 타입 학습 코칭</h4>
                    <p class="mbti-personality">개인화된 학습 전략을 제안합니다</p>
                </div>
                
                <div class="recommendation-sections">
                    <div class="recommendation-section">
                        <h5>🎯 MBTI 분석 & 학습 특성</h5>
                        <div class="recommendation-content">
                            ${markdownToHtml(result.mbtiAnalysis)}
                        </div>
                    </div>
                    
                    <div class="recommendation-section personalized">
                        <h5>🚀 개인화된 학습 전략</h5>
                        <div class="recommendation-content">
                            ${markdownToHtml(result.personalizedStrategy)}
                        </div>
                    </div>
                    
                    <div class="recommendation-section">
                        <h5>💡 구체적인 학습 팁</h5>
                        <div class="recommendation-content">
                            ${Array.isArray(result.studyTips) 
                                ? `<ul>${result.studyTips.map(tip => `<li>${markdownToHtml(tip)}</li>`).join('')}</ul>`
                                : markdownToHtml(result.studyTips)
                            }
                        </div>
                    </div>
                    
                    <div class="recommendation-section">
                        <h5>🔥 동기부여 & 집중력 향상</h5>
                        <div class="recommendation-content">
                            ${markdownToHtml(result.motivationAdvice)}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        showToast('MBTI 기반 학습 코칭이 완료되었습니다!', 'success');
        
    } catch (error) {
        console.error('MBTI 코칭 오류:', error);
        
        // API 오류 시 기본 MBTI 조언 제공
        const defaultAdvice = getMBTIDefaultAdvice(mbtiType);
        
        resultContainer.innerHTML = `
            <div class="mbti-recommendation-card">
                <div class="mbti-header">
                    <h4>${mbtiType} 타입 학습 코칭</h4>
                    <p class="mbti-personality">기본 학습 전략을 제안합니다</p>
                    <div class="offline-notice">
                        <small>💡 현재 AI 서비스에 일시적인 문제가 있어 기본 조언을 제공합니다.</small>
                    </div>
                </div>
                
                <div class="recommendation-sections">
                    <div class="recommendation-section">
                        <h5>🎯 ${mbtiType} 학습 특성</h5>
                        <div class="recommendation-content">
                            ${markdownToHtml(defaultAdvice.characteristics)}
                        </div>
                    </div>
                    
                    <div class="recommendation-section personalized">
                        <h5>🚀 추천 학습 전략</h5>
                        <div class="recommendation-content">
                            ${markdownToHtml(defaultAdvice.strategy)}
                        </div>
                    </div>
                    
                    <div class="recommendation-section">
                        <h5>💡 학습 팁</h5>
                        <div class="recommendation-content">
                            <ul>
                                ${defaultAdvice.tips.map(tip => `<li>${markdownToHtml(tip)}</li>`).join('')}
                            </ul>
                        </div>
                    </div>
                    
                    <div class="recommendation-section">
                        <h5>🔥 동기부여 방법</h5>
                        <div class="recommendation-content">
                            ${markdownToHtml(defaultAdvice.motivation)}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        showToast('MBTI 기본 학습 코칭을 제공합니다.', 'warning');
    }
}

// 기본 MBTI 조언 제공 함수
function getMBTIDefaultAdvice(mbtiType) {
    const adviceMap = {
        'INTJ': {
            characteristics: 'INTJ는 체계적이고 전략적인 학습을 선호합니다. 장기적인 목표를 설정하고 단계별로 접근하는 것을 좋아합니다.',
            strategy: '큰 그림을 먼저 파악한 후 세부 계획을 세우세요. 독립적인 학습 환경에서 집중력을 발휘할 수 있습니다.',
            tips: ['체계적인 학습 계획 수립', '조용한 환경에서 깊이 있는 학습', '개념의 연결고리 파악', '장기 목표 설정'],
            motivation: '자신만의 학습 시스템을 구축하고 지속적으로 개선해나가는 과정에서 성취감을 느끼실 것입니다.'
        },
        'INTP': {
            characteristics: 'INTP는 호기심이 많고 논리적 사고를 중시합니다. 이해를 바탕으로 한 학습을 선호합니다.',
            strategy: '왜 그런지 이유를 파악하며 학습하세요. 다양한 관점에서 접근하고 창의적인 해결책을 찾아보세요.',
            tips: ['개념의 원리 이해 중심', '자유로운 학습 스케줄', '다양한 학습 자료 활용', '논리적 연결고리 찾기'],
            motivation: '새로운 지식을 발견하고 이해하는 과정 자체가 큰 동기부여가 될 것입니다.'
        },
        'ENTJ': {
            characteristics: 'ENTJ는 목표 지향적이고 효율성을 중시합니다. 리더십을 발휘하며 학습하는 것을 좋아합니다.',
            strategy: '명확한 목표를 설정하고 효율적인 학습 방법을 찾으세요. 그룹 스터디나 토론을 통해 학습 효과를 높이세요.',
            tips: ['구체적인 목표 설정', '효율적인 시간 관리', '그룹 스터디 활용', '성과 측정 시스템 구축'],
            motivation: '목표 달성과 성과 향상이 가장 큰 동기부여 요소입니다.'
        },
        'ENTP': {
            characteristics: 'ENTP는 창의적이고 다양성을 추구합니다. 새로운 아이디어와 가능성을 탐구하는 것을 좋아합니다.',
            strategy: '다양한 학습 방법을 시도해보고 창의적인 접근을 하세요. 토론과 브레인스토밍을 활용하세요.',
            tips: ['다양한 학습 방법 시도', '창의적 접근법 활용', '토론과 대화 중심', '새로운 아이디어 탐구'],
            motivation: '새로운 도전과 창의적인 문제 해결 과정에서 에너지를 얻으실 것입니다.'
        },
        'INFJ': {
            characteristics: 'INFJ는 깊이 있고 의미 있는 학습을 선호합니다. 자신만의 속도로 꾸준히 학습하는 것을 좋아합니다.',
            strategy: '자신만의 학습 리듬을 찾고 의미 있는 연결고리를 만드세요. 조용한 환경에서 집중하세요.',
            tips: ['개인적 의미 부여', '조용한 학습 환경', '꾸준한 학습 습관', '깊이 있는 이해 추구'],
            motivation: '학습이 자신의 성장과 목표에 어떻게 도움이 되는지 연결지을 때 동기부여됩니다.'
        },
        'INFP': {
            characteristics: 'INFP는 자신의 가치와 관심사에 맞는 학습을 선호합니다. 개인적인 의미를 찾으며 학습합니다.',
            strategy: '자신의 관심사와 연결지어 학습하세요. 개인적인 목표와 가치를 반영한 학습 계획을 세우세요.',
            tips: ['개인적 관심사 연결', '자유로운 학습 스타일', '창의적 표현 활용', '개인적 가치 반영'],
            motivation: '학습 내용이 자신의 꿈과 가치에 부합할 때 가장 큰 동기를 느끼실 것입니다.'
        },
        'ENFJ': {
            characteristics: 'ENFJ는 다른 사람과 함께 학습하는 것을 좋아합니다. 협력적이고 격려하는 환경에서 잘 학습합니다.',
            strategy: '그룹 스터디나 스터디 그룹을 만들어보세요. 다른 사람을 가르치면서 함께 성장하세요.',
            tips: ['그룹 스터디 참여', '서로 격려하는 환경', '가르치며 배우기', '협력적 학습 방법'],
            motivation: '다른 사람들과 함께 성장하고 서로 도움을 주고받는 과정에서 큰 만족감을 느끼실 것입니다.'
        },
        'ENFP': {
            characteristics: 'ENFP는 열정적이고 다양한 가능성을 탐구합니다. 재미있고 창의적인 학습을 선호합니다.',
            strategy: '재미있는 학습 방법을 찾고 다양한 활동을 통해 학습하세요. 긍정적인 에너지를 유지하세요.',
            tips: ['재미있는 학습 방법', '다양한 활동 통합', '긍정적 마인드셋', '창의적 표현 활용'],
            motivation: '새로운 가능성을 발견하고 창의적으로 표현할 수 있을 때 가장 큰 동기를 느끼실 것입니다.'
        },
        'ISTJ': {
            characteristics: 'ISTJ는 체계적이고 완벽을 추구하는 성향으로 꾸준하고 안정적인 학습을 선호합니다. 계획을 세우고 착실히 실행하는 능력이 뛰어납니다.',
            strategy: '세부적인 학습 계획을 세우고 단계별로 착실히 실행하세요. 완벽한 이해를 위해 충분한 복습 시간을 확보하세요.',
            tips: ['완벽한 학습 계획 수립', '꾸준한 학습 루틴 형성', '체계적인 복습 시스템', '단계별 목표 달성', '정확한 이해 우선'],
            motivation: '계획한 목표를 차근차근 달성하며 완벽하게 학습 내용을 익혔을 때 가장 큰 성취감을 느끼실 것입니다.'
        },
        'ISFJ': {
            characteristics: 'ISFJ는 안정적이고 지지적인 환경에서 학습을 선호합니다. 실용적이고 도움이 되는 학습을 좋아합니다.',
            strategy: '편안한 학습 환경을 조성하고 실용적인 학습에 집중하세요. 다른 사람의 도움을 받는 것을 주저하지 마세요.',
            tips: ['편안한 학습 환경', '실용적 학습 내용', '지지적인 관계 구축', '도움 요청하기'],
            motivation: '학습이 자신과 다른 사람에게 도움이 된다는 것을 느낄 때 가장 큰 동기를 얻으실 것입니다.'
        },
        'ESTJ': {
            characteristics: 'ESTJ는 구조화된 학습을 선호하고 효율성을 중시합니다. 명확한 목표와 계획을 가지고 학습합니다.',
            strategy: '구체적인 목표를 설정하고 체계적으로 학습하세요. 시간 관리를 효율적으로 하고 성과를 측정하세요.',
            tips: ['구체적 목표 설정', '체계적 학습 계획', '효율적 시간 관리', '성과 측정과 평가'],
            motivation: '목표 달성과 성과 향상을 통해 성취감을 느낄 때 가장 큰 동기를 얻으실 것입니다.'
        },
        'ESFJ': {
            characteristics: 'ESFJ는 협력적이고 조화로운 학습 환경을 선호합니다. 다른 사람과 함께 학습하는 것을 좋아합니다.',
            strategy: '그룹 스터디나 협력 학습을 활용하세요. 긍정적이고 지지적인 학습 환경을 만드세요.',
            tips: ['그룹 스터디 참여', '협력적 학습 환경', '긍정적 분위기 조성', '서로 격려하기'],
            motivation: '다른 사람들과 함께 성장하고 서로 도움을 주고받을 때 가장 큰 만족감을 느끼실 것입니다.'
        },
        'ISTP': {
            characteristics: 'ISTP는 실용적이고 체험적인 학습을 선호합니다. 자신만의 방식으로 학습하는 것을 좋아합니다.',
            strategy: '실습과 체험을 통해 학습하세요. 자신만의 학습 방법을 찾고 유연하게 적용하세요.',
            tips: ['실습 중심 학습', '체험적 접근법', '자율적 학습 방식', '유연한 학습 스케줄'],
            motivation: '실제로 적용하고 체험할 수 있는 학습 내용일 때 가장 큰 흥미를 느끼실 것입니다.'
        },
        'ISFP': {
            characteristics: 'ISFP는 개인적이고 의미 있는 학습을 선호합니다. 자신의 가치와 관심사에 맞는 학습을 좋아합니다.',
            strategy: '자신의 관심사와 연결지어 학습하세요. 개인적인 의미를 찾으며 자신만의 속도로 학습하세요.',
            tips: ['개인적 관심사 연결', '의미 있는 학습', '자신만의 속도', '창의적 표현 활용'],
            motivation: '학습 내용이 자신의 가치와 관심사에 부합할 때 가장 큰 동기를 느끼실 것입니다.'
        },
        'ESTP': {
            characteristics: 'ESTP는 활동적이고 실용적인 학습을 선호합니다. 즉각적인 피드백과 변화를 좋아합니다.',
            strategy: '활동적인 학습 방법을 활용하고 실제 상황에 적용해보세요. 다양한 학습 활동을 시도하세요.',
            tips: ['활동적 학습 방법', '실제 적용 중심', '즉각적 피드백', '다양한 학습 활동'],
            motivation: '즉각적인 결과와 실용적인 활용 가능성을 볼 때 가장 큰 동기를 느끼실 것입니다.'
        },
        'ESFP': {
            characteristics: 'ESFP는 재미있고 사회적인 학습을 선호합니다. 긍정적이고 활기찬 학습 환경을 좋아합니다.',
            strategy: '재미있는 학습 방법을 찾고 다른 사람들과 함께 학습하세요. 긍정적인 에너지를 유지하세요.',
            tips: ['재미있는 학습 방법', '사회적 학습 환경', '긍정적 분위기', '다양한 활동 통합'],
            motivation: '학습 과정이 즐겁고 다른 사람들과 함께할 수 있을 때 가장 큰 동기를 느끼실 것입니다.'
        }
    };
    
    return adviceMap[mbtiType] || {
        characteristics: '각자의 고유한 학습 스타일을 가지고 있습니다.',
        strategy: '자신에게 맞는 학습 방법을 찾아 꾸준히 실행하세요.',
        tips: ['자신만의 학습 방법 찾기', '꾸준한 학습 습관', '목표 설정과 관리', '적절한 휴식'],
        motivation: '꾸준한 노력과 성장을 통해 목표를 달성하실 수 있습니다.'
    };
}

// 총 학습 시간 계산 함수
function calculateTotalStudyTime() {
    let totalMinutes = 0;
    Object.values(studyRecords).forEach(dayRecords => {
        Object.values(dayRecords).forEach(record => {
            totalMinutes += record.minutes || 0;
        });
    });
    return totalMinutes;
}

// 최근 학습 활동 분석 함수
function getRecentStudyActivity() {
    const recentDays = 7;
    const today = new Date();
    const recentActivity = [];
    
    for (let i = 0; i < recentDays; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateKey = toYYYYMMDD(date);
        
        if (studyRecords[dateKey]) {
            const dayTotal = Object.values(studyRecords[dateKey]).reduce((sum, record) => {
                return sum + (record.minutes || 0);
            }, 0);
            
            recentActivity.push({
                date: dateKey,
                minutes: dayTotal
            });
        }
    }
    
    return recentActivity;
}

// 주간 평가 데이터 업데이트 함수
function updateWeeklyEvaluation() {
    const now = getCurrentKoreanDate(); // 한국 시간 기준으로 변경
    const weekRange = getWeekRange(now);
    
    let totalPlannedHours = 0;
    let totalCompletedHours = 0;
    let totalStudyDays = 0;
    let studyDaysWithRecords = 0;
    let elapsedDays = 0;
    
    // 방학 기간 내에서만 경과일 계산
    if (vacationStartDate && vacationEndDate) {
        const currentDate = getCurrentKoreanDateString();
        const startDate = toYYYYMMDD(vacationStartDate);
        const endDate = toYYYYMMDD(vacationEndDate);
        
        // 방학 시작일부터 현재 날짜까지 또는 방학 종료일까지 중 빠른 날짜까지
        const endCalculationDate = currentDate <= endDate ? currentDate : endDate;
        
        for (let d = new Date(vacationStartDate); toYYYYMMDD(d) <= endCalculationDate; d.setDate(d.getDate() + 1)) {
            const dateKey = toYYYYMMDD(d);
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
    }
    
    // 달성률 계산 (경과일 기준)
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
        window.location.href = '/logout';
    }
}

// 공유 기능
function showShareModal() {
    const modal = document.getElementById('share-modal');
    
    // 링크 입력 필드 초기화
    document.getElementById('view-only-link').value = '';
    document.getElementById('record-link').value = '';
    
    // 버튼 상태 초기화
    document.getElementById('generate-share-links').style.display = 'block';
    document.getElementById('revoke-share-links').style.display = 'none';
    
    // 기존 공유 링크가 있는지 확인
    checkExistingShareLinks();
    
    openModal('share-modal');
}

function closeShareModal() {
    closeModal('share-modal');
}

// 기존 공유 링크 확인
async function checkExistingShareLinks() {
    try {
        const response = await fetch('/api/share/status', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.hasActiveLinks) {
                // 기존 링크 표시
                const baseUrl = window.location.origin;
                document.getElementById('view-only-link').value = `${baseUrl}/shared/view/${data.viewToken}`;
                document.getElementById('record-link').value = `${baseUrl}/shared/record/${data.recordToken}`;
                
                // 버튼 상태 변경
                document.getElementById('generate-share-links').style.display = 'none';
                document.getElementById('revoke-share-links').style.display = 'block';
            }
        }
    } catch (error) {
        console.error('공유 링크 상태 확인 오류:', error);
    }
}

// 공유 링크 생성
async function generateShareLinks() {
    const generateBtn = document.getElementById('generate-share-links');
    const originalText = generateBtn.textContent;
    
    generateBtn.textContent = '생성 중...';
    generateBtn.disabled = true;
    
    try {
        const response = await fetch('/api/share/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        if (!response.ok) {
            throw new Error('링크 생성 실패');
        }
        
        const data = await response.json();
        const baseUrl = window.location.origin;
        
        // 링크 표시
        document.getElementById('view-only-link').value = `${baseUrl}/shared/view/${data.viewToken}`;
        document.getElementById('record-link').value = `${baseUrl}/shared/record/${data.recordToken}`;
        
        // 버튼 상태 변경
        generateBtn.style.display = 'none';
        document.getElementById('revoke-share-links').style.display = 'block';
        
        showToast('공유 링크가 생성되었습니다!', 'success');
        
    } catch (error) {
        console.error('공유 링크 생성 오류:', error);
        showToast('링크 생성에 실패했습니다.', 'error');
    } finally {
        generateBtn.textContent = originalText;
        generateBtn.disabled = false;
    }
}

// 공유 링크 취소
async function revokeShareLinks() {
    if (!confirm('공유를 중단하시겠습니까? 기존 링크는 더 이상 사용할 수 없게 됩니다.')) {
        return;
    }
    
    const revokeBtn = document.getElementById('revoke-share-links');
    const originalText = revokeBtn.textContent;
    
    revokeBtn.textContent = '중단 중...';
    revokeBtn.disabled = true;
    
    try {
        const response = await fetch('/api/share/revoke', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        if (!response.ok) {
            throw new Error('공유 중단 실패');
        }
        
        // 링크 필드 초기화
        document.getElementById('view-only-link').value = '';
        document.getElementById('record-link').value = '';
        
        // 버튼 상태 변경
        revokeBtn.style.display = 'none';
        document.getElementById('generate-share-links').style.display = 'block';
        
        showToast('공유가 중단되었습니다.', 'success');
        
    } catch (error) {
        console.error('공유 중단 오류:', error);
        showToast('공유 중단에 실패했습니다.', 'error');
    } finally {
        revokeBtn.textContent = originalText;
        revokeBtn.disabled = false;
    }
}

// 링크 복사
function copyToClipboard(inputId) {
    const input = document.getElementById(inputId);
    const link = input.value;
    
    if (!link) {
        showToast('먼저 링크를 생성해주세요.', 'warning');
        return;
    }
    
    // 클립보드에 복사
    navigator.clipboard.writeText(link).then(() => {
        showToast('링크가 복사되었습니다!', 'success');
    }).catch(() => {
        // 폴백: 텍스트 선택 방식
        input.select();
        input.setSelectionRange(0, 99999); // 모바일 대응
        
        try {
            document.execCommand('copy');
            showToast('링크가 복사되었습니다!', 'success');
        } catch (err) {
            showToast('복사에 실패했습니다. 링크를 직접 선택해서 복사해주세요.', 'error');
        }
    });
} 
