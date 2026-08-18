import { useState } from 'react';
import { Copy, Check, FileText, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { buildOutputText, hasValidOutput } from '@/lib/rule-utils';
import type { IParsedRule } from '@/data/parsed-rule';
import type { IFlightInfo } from '@/data/flight-info';

interface OutputPanelProps {
  parsedRule: IParsedRule;
  flightInfo: IFlightInfo;
  isRecognizing: boolean;
  recognizeProgress: string;
}

export default function OutputPanel({ parsedRule, flightInfo, isRecognizing, recognizeProgress }: OutputPanelProps) {
  const [copied, setCopied] = useState(false);

  const outputText = buildOutputText(parsedRule, flightInfo);
  const isValid = hasValidOutput(parsedRule, flightInfo);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(outputText);
      setCopied(true);
      toast.success('已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('复制失败，请手动选择复制');
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          格式化输出结果
        </CardTitle>
        <Button
          type="button"
          size="sm"
          onClick={handleCopy}
          disabled={!isValid}
          className="gap-1.5"
        >
          {copied ? (
            <>
              <Check className="size-4" />
              已复制
            </>
          ) : (
            <>
              <Copy className="size-4" />
              一键复制
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="flex-1">
        {isRecognizing ? (
          <div className="h-full flex flex-col gap-3">
            <div className="text-sm font-medium text-muted-foreground">正在识别中，请稍候...</div>
            <div className="flex-1 rounded-lg border border-border bg-muted/20 p-4 text-sm text-foreground/80 whitespace-pre-wrap overflow-y-auto max-h-[60vh] font-mono text-xs">
              {recognizeProgress || 'AI 正在解析票规表格...'}
            </div>
          </div>
        ) : !isValid ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12 px-4">
            <div className="size-12 rounded-full bg-muted/50 flex items-center justify-center">
              <AlertCircle className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">暂无输出结果</p>
              <p className="text-xs text-muted-foreground mt-1">
                请上传票规图片并填写航班信息后，点击"开始识别"生成结果
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap select-all">
            {outputText}
          </div>
        )}

        {isValid && !isRecognizing && (
          <p className="text-xs text-muted-foreground mt-3">
            时间节点以航班计划起飞时间为基准向前倒推，精确到分钟。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
