require('dotenv').config();
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function summarizeMeeting(meetingText) {
  const prompt = `다음 회의록 내용을 핵심만 한 줄로 요약해줘:\n${meetingText}`;
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: "You summarize meeting notes into one concise sentence." },
      { role: "user", content: prompt },
    ],
    max_tokens: 100,
  });
  console.log("OpenAI raw:", JSON.stringify(completion, null, 2));
  const msg = completion.choices?.[0]?.message?.content;
  if (!msg || !msg.trim()) return "요약할 수 없습니다(빈 응답). 입력 또는 프롬프트/모델/APi를 점검하세요.";
  return msg.trim();
}


module.exports = { summarizeMeeting };
