///// MySQL datetime 호환 포맷 변환 함수
  function convertToMySQLDateString(isoString) {
    const date = new Date(isoString);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }

module.exports = function(io, socket, context) {
  const { getCurrentTeamId, getCurrentUserId, queryPromise } = context;

  // 팀 멤버 전체에게 메시지 발송
  async function notifyTeamCalendarChange(tId, content, sendUId, queryPromise) {
    // 팀원의 uId 전체 조회
    const members = await queryPromise('SELECT uId FROM TeamMem WHERE tId = ?', [tId]);
    for (const member of members) {
      await queryPromise(
        'INSERT INTO Message (uId, tId, content, sendUId) VALUES (?, ?, ?, ?)',
        [member.uId, tId, content, sendUId]
      );
    }
  }
  



  // 팀 일정 조회(팀명 포함)
  async function getTeamCalendarEvents(tId, date) {
    if (!tId || !date) return [];
    const year = parseInt(date.split('-')[0]);
    const month = parseInt(date.split('-')[1]);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    try {
      console.log('[캘린더] 쿼리 조건:', { tId, startDate, endDate });
      const events = await queryPromise(
        `SELECT c.eventId, c.title, c.description, c.startDate, c.endDate, c.isAllDay, t.tName
          FROM Calendar c
          JOIN Team t ON c.tId = t.tId
          WHERE c.tId = ? AND ((c.startDate BETWEEN ? AND ?) OR (c.endDate BETWEEN ? AND ?))`,
        [tId, startDate.toISOString(), endDate.toISOString(), startDate.toISOString(), endDate.toISOString()]
      );
      console.log('[캘린더] 쿼리 결과:', events);
      return events;
    } catch (err) {
      console.error('팀 캘린더 이벤트 조회 실패:', err);
      return [];
    }
  }


  // 모든 일정 조회 (개인 + 속한 모든 팀)
  async function getAllCalendarEvents(uId, date) {
    if (!uId || !date) return [];
    const year = parseInt(date.split('-')[0]);
    const month = parseInt(date.split('-')[1]);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    try {
      const events = await queryPromise(
        `SELECT c.eventId, c.tId, c.title, c.description, c.startDate, c.endDate, c.isAllDay, t.tName
          FROM Calendar c
          LEFT JOIN Team t ON c.tId = t.tId
        WHERE (c.uId = ? OR c.tId IN (SELECT tId FROM TeamMem WHERE uId = ?))
          AND ((c.startDate BETWEEN ? AND ?) OR (c.endDate BETWEEN ? AND ?))`,
        [uId, uId, startDate.toISOString(), endDate.toISOString(), startDate.toISOString(), endDate.toISOString()]
      );
      return events;
    } catch (err) {
      console.error('전체 캘린더 이벤트 조회 실패:', err);
      return [];
    }
  }



  socket.on('calendar-init', async ({ tId, date }) => {
    const events = await getTeamCalendarEvents(tId, date);
    console.log('[calendar-init] emit 데이터:', { tId, date, events });
    socket.emit('calendar-data', { tId, date, events });
  });

  socket.on('calendar-all', async ({ uId, date }) => {
    const events = await getAllCalendarEvents(uId, date);
    socket.emit('calendar-all-data', { uId, date, events });
  });

  socket.on('calendar-new', async (eventData) => {
    const { uId, tId, title, description, startDate, endDate, isAllDay } = eventData;
    if (!uId || !title || !startDate || !endDate) {
      console.error('필수 정보 누락');
      return;
    }
    try {
      const startDateFormatted = convertToMySQLDateString(startDate);
      const endDateFormatted = convertToMySQLDateString(endDate);
      console.log('변환된 날짜:', { startDateFormatted, endDateFormatted });


      const result = await queryPromise(
        'INSERT INTO Calendar (uId, tId, title, description, startDate, endDate, isAllDay) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uId, tId || null, title, description, startDateFormatted, endDateFormatted, isAllDay || false]
      );
      const newEvent = {
        eventId: result.insertId,
        uId,
        tId: tId || null,
        title,
        description,
        startDate: startDateFormatted,
        endDate: endDateFormatted,
        isAllDay: isAllDay || false
      };
      if (tId) {
        await notifyTeamCalendarChange(tId, 3, uId, queryPromise);
        io.to(tId.toString()).emit('calendar-event-added', newEvent);
      } else {
        socket.emit('calendar-event-added', newEvent);
      }
    } catch (err) {
      console.error('일정 추가 실패:', err);
    }
  });

  socket.on('calendar-update', async (eventData) => {
    const { eventId, uId, tId, title, description, startDate, endDate, isAllDay } = eventData;
    if (!eventId || !uId || !title || !startDate || !endDate) {
      console.error('필수정보 누락');
      return;
    }
    try {
      const startDateFormatted = convertToMySQLDateString(startDate);
      const endDateFormatted = convertToMySQLDateString(endDate);

      await queryPromise(
        `UPDATE Calendar SET title = ?, description = ?, startDate = ?, endDate = ?, isAllDay = ?, updatedAt = CURRENT_TIMESTAMP WHERE eventId = ? AND uId = ?`,
        [title, description, startDateFormatted, endDateFormatted, isAllDay || false, eventId, uId]
      );
      const updatedEvent = {
        eventId,
        uId,
        tId: tId || null,
        title,
        description,
        startDate: startDateFormatted,
        endDate: endDateFormatted,
        isAllDay: isAllDay || false
      };
      if (tId) {
        await notifyTeamCalendarChange(tId, 4, uId, queryPromise);
        io.to(tId.toString()).emit('calendar-event-updated', updatedEvent);
      } else {
        socket.emit('calendar-event-updated', updatedEvent);
      }
    } catch (err) {
      console.error('일정 수정 실패:', err);
    }
  });


  socket.on('calendar-delete', async ({ eventId }) => {
    const uId = getCurrentUserId();
    if (!eventId || !uId) {
      console.error('필수정보 누락');
      return;
    }
    try {
      const [event] = await queryPromise(
        'SELECT tId FROM Calendar WHERE eventId = ? AND uId = ?',
        [eventId, uId]
      );
      if (!event) {
        console.error('삭제할 일정을 찾지 못했습니다.');
        return;
      }
      await queryPromise('DELETE FROM Calendar WHERE eventId = ? AND uId = ?', [eventId, uId]);
      if (event.tId) {
        await notifyTeamCalendarChange(event.tId, 5, uId, queryPromise);
        io.to(event.tId.toString()).emit('calendar-event-deleted', { eventId });
      } else {
        socket.emit('calendar-event-deleted', { eventId });
      }
    } catch (err) {
      console.error('일정 삭제 실패:', err);
    }
  });
};
