import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));

// Initialize Google Gemini API on server side only
let ai: GoogleGenAI | null = null;
try {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
} catch (err) {
  console.error('Error initializing Gemini client:', err);
}

// Server-side Chat API with Search Grounding
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, contextInfo } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    if (!ai) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
      }
    }

    if (!ai) {
      return res.json({
        reply: 'Chào bạn! Tôi là Thủ thư số Xã Liên Châu. Hiện tại chưa cấu hình GEMINI_API_KEY, nhưng bạn vẫn có thể tìm kiếm, đọc sách PDF, sách lật Flipbook, nghe sách nói và trải nghiệm toàn bộ kho tài liệu của thư viện!',
        sources: [],
      });
    }

    // Format contents for Gemini
    const formattedContents = messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const systemInstruction = `Bạn là Trợ lý Thủ thư số thông minh của "THƯ VIỆN CỘNG ĐỒNG SỐ XÃ LIÊN CHÂU" (thuộc Trung tâm học tập cộng đồng xã Liên Châu).
Khẩu hiệu: "Kết nối tri thức – Lan tỏa văn hóa đọc". Triết lý: "Ai cũng có thể đọc – Ai cũng có thể học – Học mọi lúc – Học mọi nơi".

Nhiệm vụ chính của bạn:
1. Hướng dẫn và gợi ý tài liệu phù hợp cho các nhóm đối tượng: Trẻ em, Học sinh, Giáo viên, Phụ huynh, Phụ nữ, Nông dân, Người cao tuổi, Cán bộ, Người lao động.
2. Giới thiệu các hình thức đọc phong phú trong thư viện: Đọc sách PDF, Sách lật Flipbook 3D, Kho truyện tranh tương tác, Sách nói Audio, Video tri thức, và Góc học tập suốt đời.
3. Hỗ trợ người cao tuổi sử dụng "Chế độ Dễ đọc" (chữ to, tương phản cao, đọc to thành tiếng bằng Text-to-Speech).
4. Cung cấp câu trả lời hữu ích về kỹ thuật nông nghiệp (trồng trọt, chăn nuôi), kỹ năng số (dịch vụ công, bảo mật điện thoại), an toàn xã hội, lịch sử văn hóa địa phương.
5. Sử dụng Google Search khi người dùng hỏi các thông tin thời sự, thời tiết, pháp luật mới nhất hoặc tra cứu thông tin địa phương.
6. Giọng văn: Ấm áp, tận tình, mẫu mực, dễ hiểu, đậm tinh thần văn hóa cộng đồng làng quê Việt Nam hiện đại.
${contextInfo ? `\nThông tin bối cảnh hiện tại: ${JSON.stringify(contextInfo)}` : ''}`;

    let reply = '';
    const sources: Array<{ title: string; uri: string }> = [];

    try {
      // Primary call: gemini-3.5-flash with googleSearch tool
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: formattedContents,
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }],
        },
      });

      reply = response.text || 'Rất tiếc, tôi chưa có câu trả lời phù hợp. Bạn vui lòng thử lại nhé!';

      // Extract search grounding metadata if available
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      if (groundingMetadata?.groundingChunks) {
        for (const chunk of groundingMetadata.groundingChunks) {
          if (chunk.web?.uri) {
            sources.push({
              title: chunk.web.title || chunk.web.uri,
              uri: chunk.web.uri,
            });
          }
        }
      }
    } catch (apiError: any) {
      console.warn('Gemini 3.5 with search error, falling back to gemini-3.8-flash:', apiError?.message);
      // Fallback to gemini-3.8-flash without tools
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: formattedContents,
        config: {
          systemInstruction,
        },
      });
      reply = fallbackResponse.text || 'Xin chào! Thủ thư số Xã Liên Châu sẵn sàng hỗ trợ bạn tìm kiếm và khám phá kho sách.';
    }

    return res.json({ reply, sources });
  } catch (error: any) {
    console.error('Chat error:', error);
    return res.status(500).json({
      error: 'Lỗi xử lý yêu cầu trò chuyện',
      details: error.message,
    });
  }
});

// Setup Vite or static serving
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: 3000,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(port, () => {
    console.log(`Thư viện cộng đồng số xã Liên Châu server running on http://0.0.0.0:${port}`);
  });
}

startServer();
