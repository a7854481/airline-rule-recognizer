import { Plus, Trash2, Table as TableIcon, ToggleLeft, AlertTriangle, Settings2, Code2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import type { IParsedRule, ITimeInterval, ICabinRateRow } from '@/data/parsed-rule';
import { getDefault4Intervals, getDefault5Intervals, normalizeCabinCode } from '@/lib/parse-ai-result';
import { applyTransferInheritance } from '@/lib/rule-utils';
import { toast } from 'sonner';
import { useState } from 'react';

interface ParsedRuleEditorProps {
  parsedRule: IParsedRule;
  onChange: (rule: IParsedRule) => void;
  /** 目标舱位代码 —— 聚焦识别模式下仅高亮/显示该行 */
  targetCabin?: string;
  /** AI 原始返回文本（用于调试面板） */
  aiRawText?: string;
  /** 匹配调试信息 */
  matchDebugInfo?: string;
}

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

export default function ParsedRuleEditor({ parsedRule, onChange, targetCabin = '', aiRawText = '', matchDebugInfo = '' }: ParsedRuleEditorProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualCabin, setManualCabin] = useState(targetCabin || '');
  const [manualIntervalCount, setManualIntervalCount] = useState<3 | 4 | 5 | 6>(5);
  const [manualRefund, setManualRefund] = useState<string[]>(new Array(5).fill(''));
  const [manualChange, setManualChange] = useState<string[]>(new Array(5).fill(''));
  const [manualTransfer, setManualTransfer] = useState(true);

  const update = (patch: Partial<IParsedRule>) => {
    onChange({ ...parsedRule, ...patch });
  };

  const target = normalizeCabinCode(targetCabin);
  const isFocusMode = target.length > 0 && target.length <= 2;
  // 聚焦模式下，如果有目标舱位行，只展示它；否则展示全部（便于用户手动补）
  const targetRow = isFocusMode
    ? parsedRule.cabinRows.find((r) => normalizeCabinCode(r.cabinCode) === target)
    : undefined;
  const displayRows = targetRow ? [targetRow] : parsedRule.cabinRows;
  const showAllToggle = isFocusMode && parsedRule.cabinRows.length > 1;

  // ===== 区间操作 =====
  const addInterval = (kind: 'change' | 'refund') => {
    const newInterval: ITimeInterval = {
      id: genId(),
      type: 'before',
      value1: 24,
      unit: 'hour',
      rawText: '',
    };
    if (kind === 'change') {
      update({ changeIntervals: [...parsedRule.changeIntervals, newInterval] });
    } else {
      update({ refundIntervals: [...parsedRule.refundIntervals, newInterval] });
    }
    // 同步给所有舱位行加一个空费率
    const newCabinRows = parsedRule.cabinRows.map((row) => ({
      ...row,
      changeRates: kind === 'change' ? [...row.changeRates, ''] : row.changeRates,
      refundRates: kind === 'refund' ? [...row.refundRates, ''] : row.refundRates,
    }));
    update({ cabinRows: newCabinRows });
  };

  const updateInterval = (
    kind: 'change' | 'refund',
    idx: number,
    patch: Partial<ITimeInterval>,
  ) => {
    const list = kind === 'change' ? [...parsedRule.changeIntervals] : [...parsedRule.refundIntervals];
    list[idx] = { ...list[idx], ...patch };
    if (kind === 'change') update({ changeIntervals: list });
    else update({ refundIntervals: list });
  };

  const removeInterval = (kind: 'change' | 'refund', idx: number) => {
    const list = kind === 'change'
      ? parsedRule.changeIntervals.filter((_, i) => i !== idx)
      : parsedRule.refundIntervals.filter((_, i) => i !== idx);
    const newCabinRows = parsedRule.cabinRows.map((row) => ({
      ...row,
      changeRates: kind === 'change' ? row.changeRates.filter((_, i) => i !== idx) : row.changeRates,
      refundRates: kind === 'refund' ? row.refundRates.filter((_, i) => i !== idx) : row.refundRates,
    }));
    if (kind === 'change') update({ changeIntervals: list, cabinRows: newCabinRows });
    else update({ refundIntervals: list, cabinRows: newCabinRows });
  };

  // ===== 舱位行操作 =====
  const addCabinRow = () => {
    const newRow: ICabinRateRow = {
      cabinCode: '',
      changeRates: new Array(parsedRule.changeIntervals.length).fill(''),
      refundRates: new Array(parsedRule.refundIntervals.length).fill(''),
    };
    update({ cabinRows: [...parsedRule.cabinRows, newRow] });
  };

  const updateCabinRow = (idx: number, patch: Partial<ICabinRateRow>) => {
    const list = [...parsedRule.cabinRows];
    list[idx] = { ...list[idx], ...patch };
    // 如果修改了舱位代码或签转，清除继承标记（让继承逻辑重新计算）
    if (Object.prototype.hasOwnProperty.call(patch, 'cabinCode') && list[idx].transferInheritedFrom) {
      list[idx].transferInheritedFrom = undefined;
    }
    update({ cabinRows: list });
  };

  /**
   * 更新舱位行的签转值，并重新执行向上继承逻辑
   * 用户手动修改某行签转后，下方的空值行会继承它
   */
  const updateCabinTransfer = (idx: number, value: boolean | 'unknown') => {
    const list = parsedRule.cabinRows.map((r, i) => {
      if (i !== idx) return r;
      return {
        ...r,
        transferAllowed: value,
        // 手动设置值后清除继承标记（这是用户设置的，不是继承的）
        transferInheritedFrom: undefined,
      };
    });
    // 重新执行向上继承，保持下方空值行随上方变化
    const withInherit = applyTransferInheritance(list);
    update({ cabinRows: withInherit });
  };

  const removeCabinRow = (idx: number) => {
    update({ cabinRows: parsedRule.cabinRows.filter((_, i) => i !== idx) });
  };

  const updateRate = (
    rowIdx: number,
    kind: 'change' | 'refund',
    colIdx: number,
    value: string,
  ) => {
    const list = [...parsedRule.cabinRows];
    const rates = kind === 'change' ? [...list[rowIdx].changeRates] : [...list[rowIdx].refundRates];
    rates[colIdx] = value;
    list[rowIdx] = {
      ...list[rowIdx],
      [kind === 'change' ? 'changeRates' : 'refundRates']: rates,
    };
    update({ cabinRows: list });
  };

  // ===== 套用默认 5 区间模板 =====
  const applyDefaultIntervals = (kind: 'change' | 'refund') => {
    const defaults = getDefault5Intervals();
    const prefixed = defaults.map((it) => ({
      ...it,
      id: `${kind === 'change' ? 'c' : 'r'}-${it.id}-${genId()}`,
    }));

    const newCabinRows = parsedRule.cabinRows.map((row) => {
      const current = kind === 'change' ? row.changeRates : row.refundRates;
      const padded = [...current];
      while (padded.length < defaults.length) padded.push('');
      return {
        ...row,
        [kind === 'change' ? 'changeRates' : 'refundRates']: padded.slice(0, defaults.length),
      };
    });

    if (kind === 'change') {
      update({ changeIntervals: prefixed, cabinRows: newCabinRows });
    } else {
      update({ refundIntervals: prefixed, cabinRows: newCabinRows });
    }
  };

  return (
    <Card className="col-span-1 xl:col-span-2">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <TableIcon className="size-4 text-primary" />
          识别结果（可编辑校正）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 签转 + OPEN 规则 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">签转规则</div>
                <div className="text-xs text-muted-foreground">
                  {parsedRule.transferAllowed === 'unknown'
                    ? '该票规表未包含签转规则，请手动确认'
                    : '是否允许签转'}
                </div>
              </div>
              <Select
                value={
                  parsedRule.transferAllowed === 'unknown'
                    ? 'unknown'
                    : parsedRule.transferAllowed
                      ? 'true'
                      : 'false'
                }
                onValueChange={(v) => {
                  if (v === 'unknown') {
                    update({ transferAllowed: 'unknown' });
                  } else {
                    update({ transferAllowed: v === 'true' });
                  }
                }}
              >
                <SelectTrigger className="w-[130px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">未识别</SelectItem>
                  <SelectItem value="true">允许</SelectItem>
                  <SelectItem value="false">不允许</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {parsedRule.transferAllowed === 'unknown' && (
              <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded-md px-2 py-1.5 flex items-start gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                <span>未从票规表中识别到签转规则，请手动设置后再复制结果</span>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>OPEN票规则</Label>
            <Input
              value={parsedRule.openTicketRule ?? ''}
              onChange={(e) => update({ openTicketRule: e.target.value })}
              placeholder="选填，如：有效期1年"
            />
          </div>
        </div>

        {/* 自愿变更区间 */}
        <IntervalEditor
          title="自愿变更（改签）时间区间"
          intervals={parsedRule.changeIntervals}
          onAdd={() => addInterval('change')}
          onUpdate={(idx, patch) => updateInterval('change', idx, patch)}
          onRemove={(idx) => removeInterval('change', idx)}
          onApplyDefault={() => applyDefaultIntervals('change')}
        />

        {/* 自愿退票区间 */}
        <IntervalEditor
          title="自愿退票时间区间"
          intervals={parsedRule.refundIntervals}
          onAdd={() => addInterval('refund')}
          onUpdate={(idx, patch) => updateInterval('refund', idx, patch)}
          onRemove={(idx) => removeInterval('refund', idx)}
          onApplyDefault={() => applyDefaultIntervals('refund')}
        />

        {/* 舱位费率表格 */}
        <div className="space-y-3">
          <MissingRateWarning cabinRows={parsedRule.cabinRows} />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium">舱位费率表</h4>
              {isFocusMode && targetRow && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  仅显示 {target} 舱
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {['Y', 'B', 'M', 'H', 'K', 'L', 'C', 'D'].map((code) => {
                const exists = parsedRule.cabinRows.some((r) => r.cabinCode === code)
                return (
                  <Button
                    key={code}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (exists) return
                      const newRow: ICabinRateRow = {
                        cabinCode: code,
                        changeRates: new Array(parsedRule.changeIntervals.length).fill(''),
                        refundRates: new Array(parsedRule.refundIntervals.length).fill(''),
                      }
                      update({ cabinRows: [...parsedRule.cabinRows, newRow] })
                    }}
                    disabled={exists}
                    className="h-7 w-7 p-0 text-xs font-mono"
                    title={exists ? '已添加' : `添加 ${code} 舱`}
                  >
                    {code}
                  </Button>
                )
              })}
              <Button type="button" variant="outline" size="sm" onClick={addCabinRow} className="h-7">
                <Plus className="size-3.5 mr-1" />
                自定义
              </Button>
              <Dialog
                open={manualDialogOpen}
                onOpenChange={setManualDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setManualCabin(target || manualCabin || '');
                      // 根据已有区间数量决定默认模板（4或5），否则默认识别结果长度
                      const currentCount = parsedRule.changeIntervals.length || parsedRule.refundIntervals.length;
                      const count: 3 | 4 | 5 | 6 = (currentCount >= 3 && currentCount <= 6) ? currentCount as 3|4|5|6 : 5;
                      setManualIntervalCount(count);
                      setManualRefund(new Array(count).fill(''));
                      setManualChange(new Array(count).fill(''));
                      setManualTransfer(true);
                    }}
                    className="h-7 gap-1.5"
                  >
                    <Pencil className="size-3.5" />
                    手动录入
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[640px]">
                  <DialogHeader>
                    <DialogTitle>手动录入 {manualCabin || '目标'} 舱费率</DialogTitle>
                    <DialogDescription>
                      AI 识别失败时的快速兜底方案。常用费率可直接从下拉选择。
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-1.5">
                        <Label>舱位代码</Label>
                        <Input
                          value={manualCabin}
                          onChange={(e) => setManualCabin(e.target.value)}
                          placeholder="如 B / Y1"
                          maxLength={4}
                          className="w-28 uppercase"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">档位数量：</span>
                        {[3, 4, 5, 6].map((n) => (
                          <Button
                            key={n}
                            type="button"
                            size="sm"
                            variant={manualIntervalCount === n ? 'default' : 'outline'}
                            className="h-7 w-9 p-0 text-xs"
                            onClick={() => {
                              setManualIntervalCount(n as 3|4|5|6);
                              const nextR = [...manualRefund];
                              const nextC = [...manualChange];
                              while (nextR.length < n) nextR.push('');
                              while (nextC.length < n) nextC.push('');
                              setManualRefund(nextR.slice(0, n));
                              setManualChange(nextC.slice(0, n));
                            }}
                          >
                            {n}档
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>退票费率（{manualIntervalCount} 档，按时间从早到晚）</Label>
                      <div className={
                        manualIntervalCount === 3 ? 'grid grid-cols-3 gap-2' :
                        manualIntervalCount === 4 ? 'grid grid-cols-4 gap-2' :
                        manualIntervalCount === 6 ? 'grid grid-cols-6 gap-2' :
                        'grid grid-cols-5 gap-2'
                      }>
                        {manualRefund.slice(0, manualIntervalCount).map((v, i) => (
                          <Select key={`r-${i}`} value={v} onValueChange={(val) => {
                            const next = [...manualRefund];
                            next[i] = val;
                            setManualRefund(next);
                          }}>
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue placeholder={`第${i + 1}档`} />
                            </SelectTrigger>
                            <SelectContent>
                              {['免费', '0', '5%', '10%', '15%', '20%', '25%', '30%', '50%', '100%', '不得退票', '不予退票'].map((opt) => (
                                <SelectItem key={opt} value={opt} className="text-sm">{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>改签费率（{manualIntervalCount} 档，按时间从早到晚）</Label>
                      <div className={
                        manualIntervalCount === 3 ? 'grid grid-cols-3 gap-2' :
                        manualIntervalCount === 4 ? 'grid grid-cols-4 gap-2' :
                        manualIntervalCount === 6 ? 'grid grid-cols-6 gap-2' :
                        'grid grid-cols-5 gap-2'
                      }>
                        {manualChange.slice(0, manualIntervalCount).map((v, i) => (
                          <Select key={`c-${i}`} value={v} onValueChange={(val) => {
                            const next = [...manualChange];
                            next[i] = val;
                            setManualChange(next);
                          }}>
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue placeholder={`第${i + 1}档`} />
                            </SelectTrigger>
                            <SelectContent>
                              {['免费', '0', '5%', '10%', '15%', '20%', '25%', '30%', '50%', '100%', '不得改期', '不予改期'].map((opt) => (
                                <SelectItem key={opt} value={opt} className="text-sm">{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                      <Switch
                        checked={manualTransfer}
                        onCheckedChange={setManualTransfer}
                        id="manual-transfer"
                      />
                      <Label htmlFor="manual-transfer" className="cursor-pointer">
                        签转：{manualTransfer ? '允许' : '不允许'}
                      </Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button type="button" variant="outline">取消</Button>
                    </DialogClose>
                    <Button
                      type="button"
                       onClick={() => {
                         const code = normalizeCabinCode(manualCabin);
                         if (!code) {
                           toast.warning('请填写舱位代码');
                           return;
                         }
                        const existing = parsedRule.cabinRows.findIndex(
                          (r) => normalizeCabinCode(r.cabinCode) === code,
                        );
                        const newRow: ICabinRateRow = {
                          cabinCode: code,
                          changeRates: [...manualChange],
                          refundRates: [...manualRefund],
                          transferAllowed: manualTransfer,
                        };
                        let newRows: ICabinRateRow[];
                        if (existing >= 0) {
                          newRows = [...parsedRule.cabinRows];
                          newRows[existing] = newRow;
                        } else {
                          newRows = [...parsedRule.cabinRows, newRow];
                        }
                        // 如果还没有时间区间，根据模板数量应用默认区间
                        const needsChange = parsedRule.changeIntervals.length < manualIntervalCount;
                        const needsRefund = parsedRule.refundIntervals.length < manualIntervalCount;
                        if (needsChange || needsRefund) {
                          const defaults = manualIntervalCount === 4 ? getDefault4Intervals() : getDefault5Intervals();
                          update({
                            cabinRows: newRows,
                            changeIntervals: needsChange
                              ? defaults.map((it) => ({ ...it, id: `c-${it.id}-${genId()}` }))
                              : parsedRule.changeIntervals,
                            refundIntervals: needsRefund
                              ? defaults.map((it) => ({ ...it, id: `r-${it.id}-${genId()}` }))
                              : parsedRule.refundIntervals,
                            transferAllowed: manualTransfer,
                          });
                        } else {
                          update({
                            cabinRows: newRows,
                            transferAllowed: manualTransfer,
                          });
                        }
                        setManualDialogOpen(false);
                      }}
                    >
                      确认录入
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="w-full overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap min-w-[80px]">
                     舱位
                   </th>
                   <th className="px-2 py-2 text-center font-medium whitespace-nowrap min-w-[70px]">
                     折扣
                   </th>
                  {parsedRule.changeIntervals.map((it, i) => (
                    <th
                      key={it.id}
                      className="px-2 py-2 text-center font-medium whitespace-nowrap min-w-[110px] text-primary"
                    >
                      <div className="text-[11px] font-normal text-muted-foreground">改签</div>
                      {it.rawText || `区间${i + 1}`}
                    </th>
                  ))}
                  {parsedRule.refundIntervals.map((it, i) => (
                    <th
                      key={it.id}
                      className="px-2 py-2 text-center font-medium whitespace-nowrap min-w-[110px] text-warning"
                    >
                      <div className="text-[11px] font-normal text-muted-foreground">退票</div>
                      {it.rawText || `区间${i + 1}`}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center font-medium whitespace-nowrap min-w-[100px]">
                    <div className="text-[11px] font-normal text-muted-foreground">签转</div>
                    规则
                  </th>
                  <th className="px-2 py-2 text-center font-medium whitespace-nowrap min-w-[60px]">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={parsedRule.changeIntervals.length + parsedRule.refundIntervals.length + 4}
                      className="px-3 py-8 text-center text-sm text-muted-foreground"
                    >
                      暂无舱位数据。上传图片识别后自动填充，或点击上方按钮手动添加。
                    </td>
                  </tr>
                )}
                {displayRows.map((row, displayIdx) => {
                  // displayRows 可能是过滤后的子集，找到原始 index 用于操作
                  const rowIdx = parsedRule.cabinRows.indexOf(row);
                  const isTarget = isFocusMode && row.cabinCode.toUpperCase() === target;
                  return (
                    <tr
                      key={row.cabinCode + '-' + rowIdx}
                      className={`border-t border-border ${isTarget ? 'bg-primary/[0.07]' : ''}`}
                    >
                     <td className="px-3 py-2 font-medium">
                       <div className="flex flex-col gap-1">
                         <Input
                           value={row.cabinCode}
                           onChange={(e) =>
                             updateCabinRow(rowIdx, { cabinCode: e.target.value.toUpperCase() })
                           }
                           placeholder="舱位"
                           className="h-8 w-20 uppercase text-center"
                           maxLength={4}
                         />
                         {row.rowWarning && (
                           <div
                             className="text-[11px] leading-tight text-warning"
                             title={row.rowWarning}
                           >
                             ⚠ {row.rowWarning}
                           </div>
                         )}
                       </div>
                     </td>
                     <td className="px-2 py-2 text-center">
                       <Input
                         value={row.discount ?? ''}
                         onChange={(e) => updateCabinRow(rowIdx, { discount: e.target.value })}
                         placeholder="如 92%"
                         className="h-8 w-16 text-center text-xs"
                       />
                     </td>
                    {parsedRule.changeIntervals.map((_, colIdx) => {
                      const val = row.changeRates[colIdx] ?? ''
                      const isEmpty = !val
                      return (
                        <td key={`c-${rowIdx}-${colIdx}`} className="px-2 py-2">
                          <Input
                            value={val}
                            onChange={(e) => updateRate(rowIdx, 'change', colIdx, e.target.value)}
                            placeholder="如 10% / 免费"
                            className={`h-8 text-center ${isEmpty ? 'border-destructive/50 focus-visible:ring-destructive/30' : ''}`}
                          />
                        </td>
                      )
                    })}
                    {parsedRule.refundIntervals.map((_, colIdx) => {
                      const val = row.refundRates[colIdx] ?? ''
                      const isEmpty = !val
                      return (
                        <td key={`r-${rowIdx}-${colIdx}`} className="px-2 py-2">
                          <Input
                            value={val}
                            onChange={(e) => updateRate(rowIdx, 'refund', colIdx, e.target.value)}
                            placeholder="如 20% / 免费"
                            className={`h-8 text-center ${isEmpty ? 'border-destructive/50 focus-visible:ring-destructive/30' : ''}`}
                          />
                        </td>
                      )
                    })}
                    {/* 签转列：per-cabin 编辑 + 继承标注 */}
                    <td className="px-2 py-2 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Select
                          value={
                            row.transferAllowed === 'unknown' || row.transferAllowed === undefined
                              ? 'unknown'
                              : row.transferAllowed
                                ? 'true'
                                : 'false'
                          }
                          onValueChange={(v) => {
                            if (v === 'unknown') {
                              updateCabinTransfer(rowIdx, 'unknown');
                            } else {
                              updateCabinTransfer(rowIdx, v === 'true');
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 w-[96px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unknown">未识别</SelectItem>
                            <SelectItem value="true">允许</SelectItem>
                            <SelectItem value="false">不允许</SelectItem>
                          </SelectContent>
                        </Select>
                        {row.transferInheritedFrom && (
                          <span className="text-[10px] text-muted-foreground leading-tight">
                            继承自{row.transferInheritedFrom}舱
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeCabinRow(rowIdx)}
                        aria-label="删除舱位"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            <ToggleLeft className="size-3 inline mr-1" />
            提示：识别结果可能有误，请务必核对舱位与费率的对应关系，修改后右侧结果实时更新。
          </p>
        </div>

        {/* 调试信息折叠面板 */}
        {(aiRawText || matchDebugInfo) && (
          <Collapsible
            open={showRaw}
            onOpenChange={setShowRaw}
            className="rounded-lg border border-dashed border-border"
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full h-9 justify-between px-3"
              >
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Code2 className="size-3.5" />
                  <span className="text-xs font-normal">
                    查看原始识别结果 & 匹配调试信息
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {showRaw ? '收起' : '展开'}
                </span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-3 pb-3 pt-1 space-y-3">
              {matchDebugInfo && (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    舱位匹配日志
                  </div>
                  <pre className="rounded-md bg-muted/50 p-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap text-foreground/80 overflow-x-auto">
                    {matchDebugInfo}
                  </pre>
                </div>
              )}
              {aiRawText && (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    AI 原始返回内容
                  </div>
                  <pre className="rounded-md bg-muted/50 p-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap text-foreground/80 max-h-60 overflow-y-auto">
                    {aiRawText}
                  </pre>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

// ===== 子组件：缺失费率警告 =====
function MissingRateWarning({ cabinRows }: { cabinRows: ICabinRateRow[] }) {
  if (cabinRows.length === 0) return null;

  let missingCount = 0;
  for (const row of cabinRows) {
    for (const v of row.changeRates) if (!v) missingCount++;
    for (const v of row.refundRates) if (!v) missingCount++;
  }

  if (missingCount === 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
      <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
      <div className="text-xs">
        <div className="font-medium text-destructive">有 {missingCount} 个费率值为空</div>
        <div className="text-destructive/80 mt-0.5">
          红色边框标注的格子尚未识别到费率，请手动核对补全，否则右侧结果将显示为空。
        </div>
      </div>
    </div>
  );
}

// ===== 子组件：区间编辑器 =====
interface IntervalEditorProps {
  title: string;
  intervals: ITimeInterval[];
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<ITimeInterval>) => void;
  onRemove: (idx: number) => void;
}

function IntervalEditor({ title, intervals, onAdd, onUpdate, onRemove, onApplyDefault }: IntervalEditorProps & { onApplyDefault?: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <div className="flex items-center gap-1.5">
          {onApplyDefault && (
            <Button type="button" variant="outline" size="sm" onClick={onApplyDefault} className="h-7 text-xs gap-1">
              <Settings2 className="size-3.5" />
              套用 5 档模板
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onAdd} className="h-7 gap-1">
            <Plus className="size-3.5" />
            添加区间
          </Button>
        </div>
      </div>

      {intervals.length === 0 && (
        <p className="text-xs text-muted-foreground px-3 py-4 border border-dashed border-border rounded-lg text-center">
          暂无区间，上传图片识别后自动填充，或点击"添加区间"手动录入
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {intervals.map((it, idx) => (
          <div
            key={it.id}
            className="relative rounded-lg border border-border bg-muted/20 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                区间 {idx + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(idx)}
                aria-label="删除区间"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">类型</Label>
                <Select
                  value={it.type}
                  onValueChange={(v: ITimeInterval['type']) => onUpdate(idx, { type: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="before">前 N 之前</SelectItem>
                    <SelectItem value="between">前 N 至 前 M</SelectItem>
                    <SelectItem value="after">起飞后</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">单位</Label>
                <Select
                  value={it.unit}
                  onValueChange={(v: ITimeInterval['unit']) => onUpdate(idx, { unit: v })}
                  disabled={it.type === 'after'}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hour">小时</SelectItem>
                    <SelectItem value="day">天</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {it.type !== 'after' && (
              <div className={`grid gap-2 ${it.type === 'between' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <div className="space-y-1">
                  <Label className="text-[11px]">
                    {it.type === 'between' ? 'N（起始值）' : '数值 N'}
                  </Label>
                  <Input
                    type="number"
                    value={it.value1}
                    onChange={(e) => onUpdate(idx, { value1: Number(e.target.value) })}
                    className="h-8 text-sm"
                    min={0}
                  />
                </div>
                {it.type === 'between' && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">M（截止值）</Label>
                    <Input
                      type="number"
                      value={it.value2 ?? 0}
                      onChange={(e) => onUpdate(idx, { value2: Number(e.target.value) })}
                      className="h-8 text-sm"
                      min={0}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-[11px]">原始描述（选填）</Label>
              <Input
                value={it.rawText ?? ''}
                onChange={(e) => onUpdate(idx, { rawText: e.target.value })}
                placeholder="如：起飞前30天（含）"
                className="h-8 text-xs"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
