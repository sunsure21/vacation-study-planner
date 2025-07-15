/**
 * 생성된 스케줄을 HTML로 렌더링하는 함수
 * @param {object} schedule - planVacation 함수가 반환한 스케줄 객체
 * @returns {string} 렌더링된 HTML 문자열
 */
function renderSchedule(schedule) {
  const { title, outline, details } = schedule;

  const detail_html = outline.map(item => `
    <div class="card-content">
      <h3 class="text-xl font-bold">${item}</h3>
      <p class="text-gray-700 mt-2">${details[item]}</p>
    </div>
  `).join('');

  return `
    <div class="agent-card">
      <div class="card-header">
        <h2 class="text-2xl font-bold">${title}</h2>
        <p class="text-gray-500">당신을 위한 맞춤 방학 스케줄</p>
      </div>
      ${detail_html}
      <div class="card-footer">
        <button class="btn-purple2">저장하기</button>
      </div>
    </div>
  `;
}

module.exports = {
  renderSchedule,
}; 