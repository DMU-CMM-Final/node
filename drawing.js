const insertLog = require('./logger'); 


// DB에 전체 캔버스 데이터를 저장하는 비동기 함수
async function saveDrawingToDB(pId, tId, canvasData, queryPromise) {
    if (!pId || !tId || !canvasData) {
        console.error('DB 저장 실패: 필수 데이터(pId, tId, canvasData) 누락');
        return;
    }

    if (typeof canvasData !== 'string' || canvasData.length < 100) {
        console.error('DB 저장 실패: canvasData 형식이 유효한 Base64 문자열이 아닙니다.');
        return;
    }

    try {
        // Drawing 테이블에 pId를 기준으로 덮어쓰기 (UPDATE 또는 INSERT)
        await queryPromise(
            // tId가 기존 스키마에서 INT이므로 INT를 사용
            `INSERT INTO Drawing (pId, tId, canvasData) 
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE canvasData = ?, lastSaved = CURRENT_TIMESTAMP`,
            [pId, tId, canvasData, canvasData] // Base64 문자열 저장
        );
        console.log(`[DB 저장 성공] pId: ${pId}, tId: ${tId}`);
    } catch (error) {
        console.error('드로잉 캔버스 DB 저장 실패:', error);
    }
}


module.exports = function(io, socket, context) {
    // context에서 saveTimers, queryPromise 등을 받습니다.
    const { queryPromise, getCurrentTeamId, getCurrentUserId, getCurrentProjectId } = context;

    // --- 캔버스 데이터 저장 (공용 API: 5분 주기, 나가기, 연결 해제 시 사용) ---
    socket.on('save-drawing-data', async (data) => {
        const currentTeamId = getCurrentTeamId();
        const currentUserId = getCurrentUserId();
        // canvasData는 클라이언트에서 생성된 Base64 문자열 (이미지)입니다.
        const { pId, canvasData, reason } = data; 

        if (!currentTeamId || !pId || !canvasData) {
            console.error('저장 요청 실패: 필수 데이터 누락', data);
            return;
        }
        
        // Base64 문자열을 그대로 저장
        const dataToSave = canvasData; 

        await saveDrawingToDB(pId, currentTeamId, dataToSave, queryPromise);
        
        socket.emit('drawing-save-complete', { pId, reason });
        
        // 로그 기록
        await insertLog({ node: pId, tId: currentTeamId, uId: currentUserId, action: `drawing-save-${reason}` }, queryPromise);    });


    // 1. 드로잉 시작 (start-drawing) - 중계만 수행
    socket.on('start-drawing', (data) => {
        const currentTeamId = getCurrentTeamId();
        const currentUserId = getCurrentUserId();
        // 클라이언트에서 node를 받음
        const { x, y, pId, color, width, isEraser, node } = data;
        
        if (!currentTeamId || !pId || !node) return;

        socket.to(currentTeamId).emit('remote-start-drawing', {
            x, y, pId, node,
            color, width, isEraser,
            uId: currentUserId
        });
    });
        

    // 2. 드로잉 이동 (drawing-event) - 중계만 수행
    socket.on('drawing-event', (data) => {
        const currentTeamId = getCurrentTeamId();
        const { x, y, pId, node} = data;

        if (!currentTeamId || !pId || !node) return;

        socket.to(currentTeamId).emit('remote-drawing-event', {
            x, y, pId, node
        });
    });

};