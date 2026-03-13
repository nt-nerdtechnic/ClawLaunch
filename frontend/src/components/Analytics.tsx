import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, LineChart, Line } from 'recharts';
import { Loader2 } from 'lucide-react';

export function Analytics() {
  const { setUsage, config } = useStore();
  const [chartData, setChartData] = useState<any[]>([]);
  const [stats, setStats] = useState({ 
    input: { value: '0', delta: '+0%' }, 
    output: { value: '0', delta: '+0%' }, 
    cost: { value: '0', delta: '+0%' } 
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRealData();
  }, []);

  const fetchRealData = async () => {
    try {
      const logPath = config.workspacePath 
        ? `${config.workspacePath}/gateway.log` // Optimized for the detected clawdbot structure
        : '~/.openclaw/workspace/memory/usage/log.jsonl';
      const result = await window.electronAPI.exec(`cat ${logPath}`);
      if (result.code === 0 && result.stdout) {
        const lines = result.stdout.trim().split('\n');
        const dailyMap = new Map();
        let totalIn = 0;
        let totalOut = 0;

        lines.forEach(line => {
          try {
            const entry = JSON.parse(line);
            const date = entry.session_timestamp.split('T')[0].slice(5); // MM-DD
            const current = dailyMap.get(date) || { in: 0, out: 0, total: 0 };
            
            current.in += entry.input_tokens;
            current.out += entry.output_tokens;
            current.total += entry.input_tokens + entry.output_tokens;

            dailyMap.set(date, current);
            totalIn += entry.input_tokens;
            totalOut += entry.output_tokens;
          } catch (e) {}
        });

        const formatted = Array.from(dailyMap.entries()).map(([name, data]) => ({ name, tokens: data.total, in: data.in, out: data.out })).slice(-7);
        
        // Calculate Deltas (Today vs Yesterday)
        let inDelta = '+0%';
        let outDelta = '+0%';
        let costDelta = '+0%';

        if (formatted.length >= 2) {
            const today = formatted[formatted.length - 1];
            const yesterday = formatted[formatted.length - 2];
            
            const calcP = (t: number, y: number) => {
                if (y === 0) return t > 0 ? '+100%' : '+0%';
                const p = ((t - y) / y) * 100;
                return (p > 0 ? '+' : '') + p.toFixed(1) + '%';
            }
            
            inDelta = calcP(today.in, yesterday.in);
            outDelta = calcP(today.out, yesterday.out);
            const todayCost = (today.in + today.out * 2) / 1000000 * 0.5;
            const yesterdayCost = (yesterday.in + yesterday.out * 2) / 1000000 * 0.5;
            costDelta = calcP(todayCost, yesterdayCost);
        }

        setChartData(formatted);
        setStats({
          input: { value: (totalIn / 1000).toFixed(1) + 'K', delta: inDelta },
          output: { value: (totalOut / 1000).toFixed(1) + 'K', delta: outDelta },
          cost: { value: ( (totalIn + totalOut * 2) / 1000000 * 0.5 ).toFixed(2), delta: costDelta }
        });

        // 同步至全域 Store
        setUsage({
          input: totalIn,
          output: totalOut,
          history: formatted
        });
      }
    } catch (e) {
      console.error("Failed to fetch analytics", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="h-96 flex items-center justify-center text-blue-500"><Loader2 className="animate-spin mr-2" /> 正在同步主權數據...</div>;

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-right-4 duration-700 pb-20">
      <div className="grid grid-cols-3 gap-8">
        <StatCard label="總輸入 Tokens" value={stats.input.value} delta={stats.input.delta} />
        <StatCard label="總輸出 Tokens" value={stats.output.value} delta={stats.output.delta} />
        <StatCard label="預估支出 (USD)" value={`$${stats.cost.value}`} delta={stats.cost.delta} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Main Consumption Trend */}
        <div className="bg-slate-900/20 border border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
          
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-black uppercase tracking-widest text-slate-100">Token 消耗趨勢</h3>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">Daily Total Consumption (Stacked)</p>
            </div>
            <button onClick={fetchRealData} className="bg-slate-800/50 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold uppercase tracking-widest rounded-full px-4 py-2 text-slate-400 transition-all">
              Sync
            </button>
          </div>

          <div className="h-[300px] w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#475569', fontSize: 10, fontWeight: 700}}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#475569', fontSize: 10, fontWeight: 700}}
                  />
                  <Tooltip 
                    cursor={{stroke: '#1e293b', strokeWidth: 2}}
                    contentStyle={{ 
                        backgroundColor: '#0f172a', 
                        border: '1px solid #1e293b', 
                        borderRadius: '16px',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                        fontSize: '11px'
                    }}
                  />
                  <Area type="monotone" dataKey="in" name="Input" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorIn)" stackId="1" />
                  <Area type="monotone" dataKey="out" name="Output" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorOut)" stackId="1" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">暫無消耗數據記錄</div>
            )}
          </div>
        </div>

        {/* Efficiency Chart */}
        <div className="bg-slate-900/20 border border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>
          
          <div className="mb-8">
            <h3 className="text-lg font-black uppercase tracking-widest text-slate-100">推論效率分析</h3>
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">Input vs Output Ratio</p>
          </div>

          <div className="h-[300px] w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#475569', fontSize: 10, fontWeight: 700}}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#475569', fontSize: 10, fontWeight: 700}}
                  />
                  <Tooltip 
                    contentStyle={{ 
                        backgroundColor: '#0f172a', 
                        border: '1px solid #1e293b', 
                        borderRadius: '16px',
                        fontSize: '11px'
                    }}
                  />
                  <Line type="stepAfter" dataKey="in" name="Input Load" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} />
                  <Line type="stepAfter" dataKey="out" name="Output Density" stroke="#fbbf24" strokeWidth={2} dot={{ r: 4, fill: '#fbbf24', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">等待數據注入...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, delta }: { label: string, value: string, delta: string }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800/50 p-6 rounded-3xl group hover:border-blue-500/30 transition-all duration-500">
      <div className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mb-3">{label}</div>
      <div className="flex items-baseline space-x-3">
        <div className="text-3xl font-black text-slate-100 tracking-tighter">{value}</div>
        <div className={`text-xs font-bold ${delta.startsWith('+') && delta !== '+0%' ? 'text-red-400' : delta.startsWith('-') ? 'text-emerald-500' : 'text-slate-500'}`}>{delta}</div>
      </div>
    </div>
  );
}
