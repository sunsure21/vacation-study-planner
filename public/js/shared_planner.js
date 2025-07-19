// 공유된 캘린더 전용 JavaScript

// 전역 변수
let schedules = [];
let studyRecords = {};
let completedSchedules = {};
let schedulesByDate = {};
let vacationStartDate = null;
let vacationEndDate = null;

// 공유 모드 설정
const SHARED_MODE = window.SHARED_MODE || {};
const { isShared, token, canRecord, userEmail } = SHARED_MODE;

// 유틸리티 함수들 (원본과 동일)
function formatDate(date) {
    return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}시간 ${mins}분` : `${mins}분`;
}

function toYYYYMMDD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function timeToMinutes(timeStr, isEndTime = false, category = '') {
    const [hours, minutes] = timeStr.split(':').map(Number);
    let totalMinutes = hours * 60 + minutes;
    
    if (category === '취침' && isEndTime && totalMinutes < 12 * 60) {
        totalMinutes += 24 * 60;
    }
    
    return totalMinutes;
}

function shouldIncludeSchedule(schedule, date) {
    if (schedule.scheduleType === 'specific') {
        if (schedule.specificDate) {
            // 타임존 문제 방지를 위해 명시적으로 로컬 날짜 생성
            const [year, month, day] = schedule.specificDate.split('-').map(Number);
            const scheduleDate = new Date(year, month - 1, day);
            return toYYYYMMDD(date) === toYYYYMMDD(scheduleDate);
        } else if (schedule.specificWeekday !== null) {
            return date.getDay() === schedule.specificWeekday;
        }
    } else if (schedule.scheduleType === 'period') {
        if (schedule.periodStart && schedule.periodEnd) {
            // 타임존 문제 방지를 위해 명시적으로 로컬 날짜 생성
            const [startYear, startMonth, startDay] = schedule.periodStart.split('-').map(Number);
            const [endYear, endMonth, endDay] = schedule.periodEnd.split('-').map(Number);
            const startDate = new Date(startYear, startMonth - 1, startDay);
            const endDate = new Date(endYear, endMonth - 1, endDay);
            return date >= startDate && date <= endDate;
        }
    } else if (schedule.scheduleType === 'repeat') {
        if (schedule.periodStart && schedule.periodEnd) {
            // 타임존 문제 방지를 위해 명시적으로 로컬 날짜 생성
            const [startYear, startMonth, startDay] = schedule.periodStart.split('-').map(Number);
            const [endYear, endMonth, endDay] = schedule.periodEnd.split('-').map(Number);
            const startDate = new Date(startYear, startMonth - 1, startDay);
            const endDate = new Date(endYear, endMonth - 1, endDay);
            if (date < startDate || date > endDate) {
                return false;
            }
        }
        
        if (schedule.repeatType === 'daily') {
            return true;
        } else if (schedule.repeatType === 'custom' && schedule.selectedDays) {
            return schedule.selectedDays.includes(date.getDay());
        }
    }
    
    return false;
}

// 데이터 로드
async function loadSharedData() {
    try {
        const response = await fetch(`/api/shared/${token}/data`);
        if (!response.ok) {
            throw new Error('데이터 로드 실패');
        }
        
        const data = await response.json();
        
        schedules = data.schedules || [];
        studyRecords = data.studyRecords || {};
        completedSchedules = data.completedSchedules || {};
        
        if (data.vacationPeriod) {
            // 타임존 문제 방지를 위해 명시적으로 로컬 날짜 생성
            const [startYear, startMonth, startDay] = data.vacationPeriod.start.split('-').map(Number);
            const [endYear, endMonth, endDay] = data.vacationPeriod.end.split('-').map(Number);
            vacationStartDate = new Date(startYear, startMonth - 1, startDay);
            vacationEndDate = new Date(endYear, endMonth - 1, endDay);
        }
        
        generateSchedulesByDate();
        renderCalendar();
        updateWeeklyEvaluation();
        
    } catch (error) {
        console.error('공유 데이터 로드 오류:', error);
        showToast('데이터를 불러오는데 실패했습니다.', 'error');
    }
}

// 날짜별 스케줄 생성
function generateSchedulesByDate() {
    schedulesByDate = {};
    
    if (!vacationStartDate || !vacationEndDate) return;
    
    for (let date = new Date(vacationStartDate); date <= vacationEndDate; date.setDate(date.getDate() + 1)) {
        const dateKey = toYYYYMMDD(date);
        schedulesByDate[dateKey] = [];
        
        schedules.forEach(schedule => {
            if (shouldIncludeSchedule(schedule, date)) {
                schedulesByDate[dateKey].push(schedule);
            }
        });
        
        // 순공시간 슬롯 생성
        generateStudySlots(dateKey);
        
        // 최종 정렬 및 중복 제거
        schedulesByDate[dateKey] = schedulesByDate[dateKey]
            .sort((a, b) => {
                const timeA = a.startTime.split(':').map(Number);
                const timeB = b.startTime.split(':').map(Number);
                const minutesA = timeA[0] * 60 + timeA[1];
                const minutesB = timeB[0] * 60 + timeB[1];
                return minutesA - minutesB;
            });
            
        // 연속된 순공 시간 병합
        mergeConsecutiveStudySlots(dateKey);
    }
}

// 순공시간 슬롯 생성 (원본과 동일)
function generateStudySlots(dateKey) {
    if (!schedulesByDate[dateKey]) return;
    
    const daySchedules = schedulesByDate[dateKey].filter(s => !s.isStudySlot);
    
    // 방학 첫날 체크
    const isFirstVacationDay = vacationStartDate && dateKey === toYYYYMMDD(vacationStartDate);
    
    const timeSlots = Array(24 * 2).fill(false);
    
    // 방학 첫날이면 00:00-09:00 시간대를 차단
    if (isFirstVacationDay) {
        for (let i = 0; i < 18; i++) { // 9시간 * 2 = 18개 슬롯
            timeSlots[i] = true;
        }
    }
    
    // 방학 첫날이 아닌 경우 전일 취침시간 고려
    if (!isFirstVacationDay) {
        const [year, month, day] = dateKey.split('-').map(Number);
        const currentDate = new Date(year, month - 1, day);
        const previousDate = new Date(currentDate);
        previousDate.setDate(previousDate.getDate() - 1);
        const previousDateKey = toYYYYMMDD(previousDate);
        const previousSchedules = schedulesByDate[previousDateKey] || [];
        
        previousSchedules.forEach(schedule => {
            if (schedule.category === '취침') {
                const startMinutes = timeToMinutes(schedule.startTime, false, schedule.category);
                const endMinutes = timeToMinutes(schedule.endTime, true, schedule.category);
                
                if (endMinutes < startMinutes) {
                    // 전일 취침이 당일 새벽까지 이어지는 경우
                    const endSlot = Math.floor(endMinutes / 30);
                    for (let i = 0; i < endSlot && i < timeSlots.length; i++) {
                        timeSlots[i] = true;
                    }
                }
            }
        });
    }

    daySchedules.forEach(schedule => {
        const startMinutes = timeToMinutes(schedule.startTime, false, schedule.category);
        const endMinutes = timeToMinutes(schedule.endTime, true, schedule.category);
        
        let blockedStart = startMinutes;
        let blockedEnd = endMinutes;
        
        // 학원/과외도 실제 시간만 차단 (이동시간 제거)
        if (schedule.category === '취침') {
            if (endMinutes > 24 * 60) {
                for (let i = Math.floor(startMinutes / 30); i < 48; i++) {
                    timeSlots[i] = true;
                }
                for (let i = 0; i < Math.floor((endMinutes - 24 * 60) / 30); i++) {
                    timeSlots[i] = true;
                }
                return;
            } else {
                blockedStart = startMinutes;
                blockedEnd = endMinutes;
            }
        }
        
        const startSlot = Math.floor(blockedStart / 30);
        const endSlot = Math.floor(blockedEnd / 30);
        
        for (let i = startSlot; i < endSlot && i < timeSlots.length; i++) {
            timeSlots[i] = true;
        }
    });
    
    let currentStart = null;
    
    for (let i = 0; i < timeSlots.length; i++) {
        if (!timeSlots[i] && currentStart === null) {
            currentStart = i;
        } else if (timeSlots[i] && currentStart !== null) {
            const duration = (i - currentStart) * 30;
            if (duration >= 60) {
                addStudySlot(dateKey, currentStart, i, duration);
            }
            currentStart = null;
        }
    }
    
    if (currentStart !== null) {
        const duration = (timeSlots.length - currentStart) * 30;
        if (duration >= 60) {
            addStudySlot(dateKey, currentStart, timeSlots.length, duration);
        }
    }
}

function addStudySlot(dateKey, startSlot, endSlot, duration) {
    const startHour = Math.floor(startSlot / 2);
    const startMinute = (startSlot % 2) * 30;
    const endHour = Math.floor(endSlot / 2);
    const endMinute = (endSlot % 2) * 30;
    
    const startTime = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
    const endTime = `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`;
    
    const studySlot = {
        id: `study-${dateKey}-${startSlot}`,
        title: `순공 가능 시간`,
        category: '순공',
        startTime: startTime,
        endTime: endTime,
        isStudySlot: true,
        duration: duration
    };
    
    schedulesByDate[dateKey].push(studySlot);
    
    // 시간 순서로 정렬
    schedulesByDate[dateKey].sort((a, b) => {
        const timeA = a.startTime.split(':').map(Number);
        const timeB = b.startTime.split(':').map(Number);
        const minutesA = timeA[0] * 60 + timeA[1];
        const minutesB = timeB[0] * 60 + timeB[1];
        return minutesA - minutesB;
    });
}

// 연속된 순공 시간 병합
function mergeConsecutiveStudySlots(dateKey) {
    if (!schedulesByDate[dateKey]) return;
    
    const schedules = schedulesByDate[dateKey];
    const merged = [];
    let i = 0;
    
    while (i < schedules.length) {
        const current = schedules[i];
        
        if (current.isStudySlot) {
            // 연속된 순공 시간들을 찾아서 병합
            let endTime = current.endTime;
            let totalDuration = current.duration;
            let j = i + 1;
            
            while (j < schedules.length && schedules[j].isStudySlot) {
                const next = schedules[j];
                // 현재 슬롯의 끝 시간과 다음 슬롯의 시작 시간이 같으면 병합
                if (endTime === next.startTime) {
                    endTime = next.endTime;
                    totalDuration += next.duration;
                    j++;
                } else {
                    break;
                }
            }
            
            // 병합된 순공 시간 슬롯 생성
            const mergedSlot = {
                ...current,
                endTime: endTime,
                duration: totalDuration,
                title: `순공 가능 시간`
            };
            
            merged.push(mergedSlot);
            i = j;
        } else {
            merged.push(current);
            i++;
        }
    }
    
    schedulesByDate[dateKey] = merged;
}

// 캘린더 렌더링 (원본과 유사하지만 수정 기능 제거)
function renderCalendar() {
    const container = document.getElementById('calendar-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!vacationStartDate || !vacationEndDate) {
        container.innerHTML = '<p>방학 기간이 설정되지 않았습니다.</p>';
        return;
    }
    
    const calendarDiv = document.createElement('div');
    calendarDiv.className = 'calendar-grid';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let date = new Date(vacationStartDate); date <= vacationEndDate; date.setDate(date.getDate() + 1)) {
        const dateKey = toYYYYMMDD(date);
        const daySchedules = schedulesByDate[dateKey] || [];
        
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        
        if (date.getTime() === today.getTime()) {
            dayCell.classList.add('today');
        }
        
        const dateNumber = document.createElement('div');
        dateNumber.className = 'date-number';
        dateNumber.textContent = date.getDate();
        dayCell.appendChild(dateNumber);
        
        const schedulesContainer = document.createElement('div');
        schedulesContainer.className = 'day-schedules';
        
        daySchedules.forEach(schedule => {
            const scheduleItem = document.createElement('div');
            let className = 'schedule-item';
            
            if (schedule.isStudySlot) {
                className += ' study-slot';
            } else {
                className += ` category-${schedule.category}`;
                
                const isCompleted = completedSchedules[dateKey] && completedSchedules[dateKey][schedule.id];
                if (isCompleted) {
                    className += ' completed';
                }
            }
            
            scheduleItem.className = className;
            scheduleItem.setAttribute('data-category', schedule.category || '기타');
            scheduleItem.textContent = schedule.title || schedule.category;
            schedulesContainer.appendChild(scheduleItem);
        });
        
        dayCell.appendChild(schedulesContainer);
        
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
        
        dayCell.addEventListener('click', () => showDayModal(dateKey, daySchedules));
        calendarDiv.appendChild(dayCell);
    }
    
    container.appendChild(calendarDiv);
}

// 일별 모달 (읽기 전용 또는 제한된 기능)
function showDayModal(dateKey, daySchedules) {
    const modal = document.getElementById('day-summary-modal');
    const title = document.getElementById('day-summary-title');
    const content = document.getElementById('day-summary-content');
    
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    title.textContent = `${formatDate(date)} 요약`;
    
    // 통계 계산
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
            const scheduleCardClass = isCompleted ? 'schedule-card completed' : 'schedule-card';
            
            modalHtml += `
                <div class="${scheduleCardClass}">
                    <div class="schedule-info">
                        <div class="schedule-title">${schedule.title || schedule.category}</div>
                        <div class="schedule-time">${schedule.startTime} - ${schedule.endTime}</div>
                    </div>
                    ${!canRecord ? '<div class="readonly-badge">읽기 전용</div>' : ''}
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
                <h3>순공 가능 시간대 ${canRecord ? '(클릭하여 입력)' : ''}</h3>
        `;
        
        studySlots.forEach((slot, index) => {
            const slotId = `${dateKey}-${index}`;
            const recordedTime = studyRecords[dateKey] && studyRecords[dateKey][slotId] ? 
                studyRecords[dateKey][slotId].minutes : 0;
            
            const clickHandler = canRecord ? `onclick="showStudyTimeModal('${slotId}', '${dateKey}', '${slot.startTime}', '${slot.endTime}')"` : '';
            
            modalHtml += `
                <div class="time-slot ${canRecord ? 'clickable' : ''}" ${clickHandler}>
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
    
    content.innerHTML = modalHtml;
    openModal('day-summary-modal');
}

// 순공시간 입력 모달 (record 권한만)
function showStudyTimeModal(slotId, dateKey, startTime, endTime) {
    if (!canRecord) {
        showToast('실적 입력 권한이 없습니다.', 'warning');
        return;
    }
    
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

// 순공시간 저장 (공유 API 사용)
async function saveStudyTime(slotId, dateKey) {
    const minutes = parseInt(document.getElementById('study-minutes').value) || 0;
    const subject = document.getElementById('study-subject').value.trim();
    const notes = document.getElementById('study-notes').value.trim();
    
    try {
        const response = await fetch(`/api/shared/${token}/study-record`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                dateKey,
                slotId,
                minutes,
                subject,
                notes
            })
        });
        
        if (!response.ok) {
            throw new Error('저장 실패');
        }
        
        // 로컬 데이터 업데이트
        if (!studyRecords[dateKey]) {
            studyRecords[dateKey] = {};
        }
        
        studyRecords[dateKey][slotId] = {
            minutes,
            subject,
            notes,
            timestamp: new Date().toISOString()
        };
        
        closeStudyTimeModal();
        showToast('학습 시간이 저장되었습니다.', 'success');
        
        // 화면 업데이트
        renderCalendar();
        updateWeeklySchedule();
        updateWeeklyEvaluation();
        closeModal('day-summary-modal');
        
    } catch (error) {
        console.error('순공시간 저장 오류:', error);
        showToast('저장에 실패했습니다.', 'error');
    }
}



// 주간 평가 업데이트
function updateWeeklyEvaluation() {
    const container = document.querySelector('#evaluation-box');
    if (!container || !vacationStartDate || !vacationEndDate) return;
    
    const currentDate = toYYYYMMDD(new Date());
    const startDate = toYYYYMMDD(vacationStartDate);
    const endDate = toYYYYMMDD(vacationEndDate);
    
    let totalPlannedHours = 0;
    let totalCompletedHours = 0;
    let elapsedDays = 0;
    
    const endCalculationDate = currentDate <= endDate ? currentDate : endDate;
    
    for (let d = new Date(vacationStartDate); toYYYYMMDD(d) <= endCalculationDate; d.setDate(d.getDate() + 1)) {
        const dateKey = toYYYYMMDD(d);
        const daySchedules = schedulesByDate[dateKey] || [];
        const dayStudyRecord = studyRecords[dateKey] || {};
        
        elapsedDays++;
        
        let dayPlannedHours = 0;
        daySchedules.forEach(schedule => {
            if (schedule.isStudySlot) {
                dayPlannedHours += schedule.duration || 0;
            }
        });
        
        if (dayPlannedHours > 0) {
            totalPlannedHours += dayPlannedHours;
            
            const completedHours = Object.values(dayStudyRecord).reduce((sum, record) => {
                return sum + (record.minutes || 0);
            }, 0);
            
            totalCompletedHours += completedHours;
        }
    }
    
    const achievementRate = totalPlannedHours > 0 ? 
        Math.round((totalCompletedHours / totalPlannedHours) * 100) : 0;
    
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
    
    container.innerHTML = `
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

// 모달 관리
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

// 토스트 알림
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

// 초기화
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔗 공유 캘린더 로드 시작');
    
    // 모달 닫기 이벤트
    const dayModalClose = document.getElementById('day-modal-close');
    if (dayModalClose) {
        dayModalClose.addEventListener('click', () => closeModal('day-summary-modal'));
    }
    
    const studyModalClose = document.getElementById('study-modal-close');
    if (studyModalClose) {
        studyModalClose.addEventListener('click', closeStudyTimeModal);
    }
    
    // 모달 외부 클릭 닫기
    window.addEventListener('click', (event) => {
        const modals = ['day-summary-modal', 'study-time-modal'];
        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (event.target === modal) {
                closeModal(modalId);
            }
        });
    });
    
    // 데이터 로드
    loadSharedData();
}); 