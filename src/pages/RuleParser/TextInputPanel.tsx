import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { capabilityClient, logger } from '@lark-apaas/client-toolkit-lite';

const PLUGIN_ID = 'ticket_rule_text_parsing_1';

interface TextInputPanelProps {
  onParseStart: () => void;
  onParseChunk: (chunk: string) => void;
  onParseComplete: (rawText: string, success: boolean) => void;
  textContent: string;
  setTextContent: (text: string) => void;
  isParsing: boolean;
}

export default function TextInputPanel({
  onParseStart,
  onParseChunk,
  onParseComplete,
  textContent,
  setTextContent,
  isParsing,
}: TextInputPanelProps) {
  const handleParse = async () => {
    const trimmed = textContent.trim();
    if (!trimmed) {
      toast.error('请粘贴票规文本内容');
      return;
    }
    if (trimmed.length < 10) {
      toast.error('票规文本过短，请粘贴完整的票规内容');
      return;
    }

    onParseStart();
    let fullText = '';

    try {
      const executor = (capabilityClient as any).load(PLUGIN_ID);
      const stream = (executor as any).callStream('textGenerate', {
        ticket_rule_text: trimmed,
      });

      for await (const chunk of stream) {
        const piece = chunk.content ?? chunk.response ?? '';
        if (piece) {
          fullText += piece;
          onParseChunk(piece);
        }
      }

      onParseComplete(fullText, true);
      toast.success('解析完成，请核对结果');
    } catch (err) {
      logger.error('票规文本解析失败:', String(err));
      toast.error('解析失败，请重试或手动输入数据');
      onParseComplete(fullText, false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          粘贴票规文本
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={textContent}
          onChange={(e) => setTextContent(e.target.value)}
          placeholder="粘贴票规文本，支持舱位费率表、退改签规则等...

示例：
舱位等级：Y/B/M/E/K/H/L/N/V/U
自愿退票：
- 起飞前30天（含）之前：免费
- 起飞前30天-7天：10%
- 起飞前7天-48小时：20%
- 起飞前48小时-4小时：50%
- 起飞前4小时-起飞后：不得退票
自愿变更：
- 起飞前30天（含）之前：免费
- 起飞前30天-7天：5%
- 起飞前7天-48小时：10%
- 起飞前48小时-4小时：30%
- 起飞前4小时-起飞后：50%
自愿签转：不允许
OPEN票：有效期1年"
          className="min-h-[220px] resize-y font-mono text-sm leading-relaxed"
          disabled={isParsing}
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {textContent.length} 字符
          </span>
          <Button type="button" onClick={handleParse} disabled={isParsing || !textContent.trim()}>
            {isParsing ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                正在解析中...
              </>
            ) : (
              <>开始解析文本</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
