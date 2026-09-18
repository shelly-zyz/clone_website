import { defineProject } from '@xiaoyun/voice/server';

const appUrl = process.env.ENERGY_APP_URL || 'http://127.0.0.1:3000';
export default defineProject({
  id: 'power-earth',
  description: '中国电力运行研究台。所有能源数据问答必须调用 energy_query；该工具复用 DeepSeek EnergyIR 规划、语义白名单、只读 PostgreSQL 查询和来源验证。不得自行推测设施数或以联网搜索代替项目数据库。不得执行 SQL 或写入数据。无实测数据时不能给出预测、调度或实时碳强度。切换省份使用页面 select_province 动作。回答区分公开映射样本、官方统计、气象预报和长期情景。',
  databases: {},
  tools: [{
    name: 'energy_query',
    description: '能源可信问数：设施样本、来源、图层、气象与预测就绪状态。',
    parameters: { type: 'object', properties: { question: { type: 'string', minLength: 1, maxLength: 300 } }, required: ['question'], additionalProperties: false },
    readOnly: true,
    voiceDirect: true,
    async execute({ question }, { signal, contextAtStart, originalQuestion }) {
      const response = await fetch(new URL('/api/energy-ir/query', appUrl), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: originalQuestion || question, context: contextAtStart }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '项目数据服务暂不可用。');
      return body;
    },
    formatResult(answer) {
      const result = answer.result;
      const summary = result?.summary || answer.message;
      if (!summary) throw new Error('问数接口没有返回可验证的摘要。');
      const escape = value => String(value ?? '未知').replace(/[\\`*_{}[\]<>|]/g, '\\$&');
      return {
        summary,
        data: { kind: 'energy-ir', status: answer.status, result, trace: answer.trace },
        markdown: result ? [
          '### 数据与口径', ...result.facts.map(f => `- ${escape(f.label)}：${escape(f.value)} ${escape(f.unit)}`),
          '\n### 来源', ...result.provenance.map(p => `- ${escape(p.source)} · ${escape(p.timeRange)}\n  ${escape(p.limitation)}`),
        ].join('\n') : undefined,
      };
    },
  }],
});
