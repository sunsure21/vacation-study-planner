# 방학 순공 플래너 (Vacation Study Planner)

효율적인 방학 순공을 위한 스케줄 관리 시스템

## 🌟 주요 기능

- **구글 OAuth 로그인**: 안전한 사용자 인증
- **방학 기간 설정**: 개인별 방학 기간 맞춤 설정
- **스케줄 관리**: 일정 등록, 수정, 완료 처리
- **MBTI 기반 학습 코칭**: 개인 성향에 맞는 학습 조언
- **학습 시간 추적**: 계획 대비 실제 학습 시간 분석
- **사용자별 데이터 분리**: 개인 정보 보호

## 🚀 기술 스택

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js, Express
- **Database**: Vercel KV (Redis)
- **Authentication**: Google OAuth 2.0
- **AI**: Google Gemini API
- **Deployment**: Vercel

## 📦 설치 및 실행

### 로컬 개발 환경

1. **저장소 클론**
   ```bash
   git clone <repository-url>
   cd vacation_schedule2
   ```

2. **의존성 설치**
   ```bash
   npm install
   ```

3. **환경 변수 설정**
   `.env` 파일을 생성하고 다음 내용을 추가:
   ```
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   GOOGLE_API_KEY=your_google_api_key
   SESSION_SECRET=your_session_secret
   ```

4. **서버 실행**
   ```bash
   npm start
   ```

### Vercel 배포

1. **Vercel에 프로젝트 연결**
   ```bash
   vercel --prod
   ```

2. **Vercel KV 설정**
   - Vercel 대시보드에서 Storage 탭으로 이동
   - "Create Database" → "KV" 선택
   - 프로젝트에 연결하면 환경 변수가 자동으로 설정됨

3. **환경 변수 설정**
   Vercel 대시보드에서 환경 변수 설정:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET` 
   - `GOOGLE_API_KEY`
   - `SESSION_SECRET`

## 🗄️ 데이터 구조

### Vercel KV 키 구조
```
user:{userEmail}:vacationPeriod    - 방학 기간 설정
user:{userEmail}:schedules         - 스케줄 데이터
user:{userEmail}:studyRecords      - 학습 기록
user:{userEmail}:completedSchedules - 완료된 스케줄
```

## 🔐 보안 고려사항

- 사용자 데이터는 이메일별로 완전히 분리
- Vercel KV 연결은 환경 변수로 자동 관리
- 모든 API 엔드포인트는 인증 필요

## 📱 사용법

1. **로그인**: 구글 계정으로 로그인
2. **방학 기간 설정**: 개인 방학 기간 입력
3. **스케줄 등록**: 일정 추가 및 관리
4. **학습 기록**: 실제 학습 시간 입력
5. **MBTI 코칭**: 개인 성향 기반 학습 조언 받기

## 🤝 기여하기

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 라이선스

This project is licensed under the MIT License.

## 📞 문의

프로젝트 관련 문의: wyou@wonderslab.kr # 재배포 트리거 Wed Jul 16 14:01:48 KST 2025
# API 디렉토리 제거 완료 Wed Jul 16 14:09:40 KST 2025
