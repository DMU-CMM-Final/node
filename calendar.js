module.exports = function(io, socket, context) {
  const { getCurrentTeamId, getCurrentUserId, queryPromise } = context;

  // 팀 일정만 조회 (해당 달)
  async function getTeamCalendarEvents(tId, date) {
    if (!tId || !date) return [];
    const year = parseInt(date.split('-')[0]);
    const month = parseInt(date.split('-')[1]);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    try {
      const events = await queryPromise(
        `SELECT eventId, title, description, startDate, endDate, isAllDay FROM Calendar WHERE tId = ? AND ((startDate BETWEEN ? AND ?) OR (endDate BETWEEN ? AND ?))`,
        [tId, startDate.toISOString(), endDate.toISOString(), startDate.toISOString(), endDate.toISOString()]
      );
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
        `SELECT eventId, tId, title, description, startDate, endDate, isAllDay FROM Calendar WHERE (uId = ? OR tId IN ( SELECT tId FROM TeamMember WHERE uId = ? )) AND ((startDate BETWEEN ? AND ?) OR (endDate BETWEEN ? AND ?))`,
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
      const result = await queryPromise(
        'INSERT INTO Calendar (uId, tId, title, description, startDate, endDate, isAllDay) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uId, tId || null, title, description, startDate, endDate, isAllDay || false]
      );
      const newEvent = {
        eventId: result.insertId,
        uId,
        tId: tId || null,
        title,
        description,
        startDate,
        endDate,
        isAllDay: isAllDay || false
      };
      if (tId) {
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
      await queryPromise(
        `UPDATE Calendar SET title = ?, description = ?, startDate = ?, endDate = ?, isAllDay = ?, updatedAt = CURRENT_TIMESTAMP WHERE eventId = ? AND uId = ?`,
        [title, description, startDate, endDate, isAllDay || false, eventId, uId]
      );
      const updatedEvent = {
        eventId,
        uId,
        tId: tId || null,
        title,
        description,
        startDate,
        endDate,
        isAllDay: isAllDay || false
      };
      if (tId) {
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
        io.to(event.tId.toString()).emit('calendar-event-deleted', { eventId });
      } else {
        socket.emit('calendar-event-deleted', { eventId });
      }
    } catch (err) {
      console.error('일정 삭제 실패:', err);
    }
  });
};
