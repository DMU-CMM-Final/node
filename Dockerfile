FROM node:22-alpine

# 컨테이너 내부 작업 디렉토리 설정
WORKDIR /app

# package.json 및 package-lock.json 복사
COPY package*.json ./

# 의존성 설치
RUN npm install

# 프로젝트의 모든 파일 복사
COPY . /app

# 컨테이너에서 실행할 포트 지정
EXPOSE 3000

# 애플리케이션 시작 명령어
CMD ["node", "server.js"]
