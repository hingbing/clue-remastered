# Clue Remastered

오리지널 저택 보드판 기반 실시간 멀티플레이 추리 게임입니다.

## 기능
- 방 생성/참가
- 2개 주사위 합산 이동
- 대각선 이동 불가
- 탑뷰 보드판
- 이동 가능 칸 하이라이트
- 방 도착 시 줌 화면
- 추리/반증/최종 고발
- 추리노트
- 새로고침 재접속 복구

## 실행
```bash
npm install
npm run install:all
npm run dev
```

프론트: http://localhost:5173
서버: http://localhost:4000

## 배포
서버 Render 환경변수:
```txt
CLIENT_URL=https://프론트주소
PORT=4000
```

프론트 Vercel 환경변수:
```txt
VITE_SERVER_URL=https://서버주소
```
