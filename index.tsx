
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { TradingConfig, TradeStatus, CoinInfo, TradeRecord } from './types';
import { fetchMarketList, fetchTickerData, fetchCandles, CandleData, fetchDailyCandlesLong, placeUpbitOrder } from './services/upbitService';
import InputGroup from './components/InputGroup';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

interface BacktestResult {
  totalProfit: number;
  profitRate: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  maxDrawdown: number;
}

const STORAGE_KEY = 'upbit_bot_config_v2';

const App: React.FC = () => {
  // --- State ---
  const [activeSection, setActiveSection] = useState<'main' | 'results'>('main');
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [publicIp, setPublicIp] = useState<string>('로딩 중...');
  const [connectionIp, setConnectionIp] = useState<string | null>(null);
  const [isCheckingIp, setIsCheckingIp] = useState(false);

  // Load initial config from localStorage or use defaults
  const [config, setConfig] = useState<TradingConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          useProxy: parsed.useProxy !== undefined ? parsed.useProxy : true
        };
      } catch (e) {
        console.error("Failed to parse saved config", e);
      }
    }
    return {
      accessKey: '',
      secretKey: '',
      coin: 'KRW-BTC',
      maxBuySteps: 10,
      buyInterval: 2.0,
      targetProfit: 3.0,
      stopLoss: 10.0,
      initialAmount: 1,
      premiumRate: 0,
      useProxy: true,
    };
  });

  const [status, setStatus] = useState<TradeStatus & { lastBuyPrice: number }>({
    isActive: false,
    currentStep: 0,
    averagePrice: 0,
    totalQuantity: 0,
    totalInvested: 0,
    currentPrice: 0,
    pnlPercentage: 0,
    currentChangeRate: 0,
    lastBuyPrice: 0,
  });

  const [markets, setMarkets] = useState<CoinInfo[]>([]);
  const [priceHistory, setPriceHistory] = useState<{ time: string, price: number }[]>([]);
  const [candleHistory, setCandleHistory] = useState<CandleData[]>([]);
  const [viewType, setViewType] = useState<'live' | 'days' | 'weeks' | 'months'>('live');
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(true);
  const [isLoadingCandles, setIsLoadingCandles] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [btResult, setBtResult] = useState<BacktestResult | null>(null);
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);
  
  // Coin Search States
  const [coinSearch, setCoinSearch] = useState('');
  const [showCoinResults, setShowCoinResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const lastPriceRef = useRef<number>(0);
  
  // Ref to track latest state
  const statusRef = useRef(status);
  const configRef = useRef(config);
  const marketsRef = useRef(markets);
  const isStartingRef = useRef(isStarting);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { marketsRef.current = markets; }, [markets]);
  useEffect(() => { isStartingRef.current = isStarting; }, [isStarting]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  // UI States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiVerificationStatus, setApiVerificationStatus] = useState<'idle' | 'checking' | 'success' | 'fail'>('idle');

  const currentCoinInfo = markets.find(m => m.market === config.coin);
  const currentCoinName = currentCoinInfo?.korean_name || '로딩 중...';

  // --- Effects ---
  const fetchIp = useCallback(async (useProxy: boolean = false) => {
    if (useProxy) setIsCheckingIp(true);
    try {
      const targetUrl = 'https://api.ipify.org?format=json';
      const url = useProxy 
        ? `https://corsproxy.io/?${encodeURIComponent(targetUrl)}` 
        : targetUrl;
        
      const response = await fetch(url);
      const data = await response.json();
      if (useProxy) {
        setConnectionIp(data.ip);
      } else {
        setPublicIp(data.ip);
      }
    } catch (e) {
      if (useProxy) setConnectionIp('IP 확인 실패');
      else setPublicIp('확인 불가');
    } finally {
      if (useProxy) setIsCheckingIp(false);
    }
  }, []);

  const loadMarkets = useCallback(async () => {
    try {
        setIsLoadingMarkets(true);
        const list = await fetchMarketList();
        if (list && Array.isArray(list)) {
            setMarkets(list);
        }
    } catch (e) {
        console.error("Failed to load markets", e);
    } finally {
        setIsLoadingMarkets(false);
    }
  }, []);

  useEffect(() => {
    loadMarkets();
    fetchIp(false);
  }, [loadMarkets, fetchIp]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowCoinResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setPriceHistory([]);
    if (viewType !== 'live') {
      loadCandles();
    }
  }, [config.coin, viewType]);

  const loadCandles = async () => {
    if (viewType === 'live') return;
    try {
        setIsLoadingCandles(true);
        const data = await fetchCandles(config.coin, viewType);
        if (data && Array.isArray(data)) {
            setCandleHistory(data);
        }
    } catch (e) {
        console.error("Failed to load candles", e);
    } finally {
        setIsLoadingCandles(false);
    }
  };

  /**
   * 실시간 업데이트 루프
   */
  useEffect(() => {
    const updateLoop = async () => {
      if (isStartingRef.current) return;

      const currentCoin = configRef.current.coin;
      try {
        const ticker = await fetchTickerData(currentCoin);
        if (ticker) {
          setIsNetworkError(false);
          const currentPrice = ticker.price;
          
          if (lastPriceRef.current !== 0) {
            if (currentPrice > lastPriceRef.current) setPriceFlash('up');
            else if (currentPrice < lastPriceRef.current) setPriceFlash('down');
            setTimeout(() => setPriceFlash(null), 300);
          }
          lastPriceRef.current = currentPrice;

          const currentStatus = statusRef.current;
          const currentConf = configRef.current;
          
          if (currentStatus.isActive) {
            const pnl = ((currentPrice - currentStatus.averagePrice) / (currentStatus.averagePrice || currentPrice)) * 100;
            
            if (pnl >= currentConf.targetProfit || pnl <= -currentConf.stopLoss) {
              const exitType = pnl >= currentConf.targetProfit ? 'PROFIT' : 'LOSS';
              const record: TradeRecord = {
                id: Date.now().toString(),
                timestamp: new Date().toLocaleString(),
                coin: currentConf.coin,
                coinName: marketsRef.current.find(m => m.market === currentConf.coin)?.korean_name || currentConf.coin,
                exitType,
                pnlPercentage: pnl,
                pnlAmount: currentStatus.totalInvested * (pnl / 100),
                totalInvested: currentStatus.totalInvested,
                finalStep: currentStatus.currentStep
              };
              
              setTradeHistory(h => [record, ...h]);
              try {
                await placeUpbitOrder(currentConf.coin, 'ask', 'market', currentPrice, currentStatus.totalQuantity);
              } catch (e) {
                console.error("Exit order failed", e);
              }

              setStatus(prev => ({ 
                ...prev, 
                isActive: false, 
                currentStep: 0, 
                pnlPercentage: 0, 
                totalInvested: 0, 
                totalQuantity: 0, 
                averagePrice: 0, 
                lastBuyPrice: 0,
                currentPrice,
                currentChangeRate: ticker.changeRate
              }));
            } 
            else if (currentStatus.currentStep < currentConf.maxBuySteps && currentPrice <= currentStatus.lastBuyPrice * (1 - currentConf.buyInterval / 100)) {
              const nextStep = currentStatus.currentStep + 1;
              const currentBuyAmount = (currentConf.initialAmount * 10000) * Math.pow(1 + currentConf.premiumRate / 100, nextStep - 1);
              
              try {
                await placeUpbitOrder(currentConf.coin, 'bid', 'price', currentBuyAmount);

                const newTotalInvested = currentStatus.totalInvested + currentBuyAmount;
                const newTotalQuantity = currentStatus.totalQuantity + (currentBuyAmount / currentPrice);
                const newAveragePrice = newTotalInvested / newTotalQuantity;

                setStatus(prev => ({
                  ...prev,
                  currentStep: nextStep,
                  averagePrice: newAveragePrice,
                  totalQuantity: newTotalQuantity,
                  totalInvested: newTotalInvested,
                  lastBuyPrice: currentPrice,
                  currentPrice,
                  currentChangeRate: ticker.changeRate,
                  pnlPercentage: ((currentPrice - newAveragePrice) / (newAveragePrice || 1)) * 100
                }));
              } catch (e) {
                console.error("Scaling buy order failed", e);
              }
            }
            else {
              setStatus(prev => ({
                ...prev,
                currentPrice,
                currentChangeRate: ticker.changeRate,
                pnlPercentage: pnl
              }));
            }
          } else {
            setStatus(prev => ({ ...prev, currentPrice, currentChangeRate: ticker.changeRate }));
          }
          
          setPriceHistory(prev => {
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            if (prev.length > 0 && prev[prev.length - 1].time === timeStr) return prev;
            return [...prev, { time: timeStr, price: currentPrice }].slice(-40);
          });
        } else {
          setIsNetworkError(true);
        }
      } catch (err) {
        setIsNetworkError(true);
      }
    };

    const intervalId = setInterval(updateLoop, 1000);
    return () => clearInterval(intervalId);
  }, []);

  const handleChange = (field: keyof TradingConfig, value: string | number | boolean) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    if (field === 'accessKey' || field === 'secretKey') {
      setApiVerificationStatus('idle');
    }
  };

  const verifyApi = async () => {
    if (!config.accessKey || !config.secretKey) {
      alert('Key를 모두 입력해주세요.');
      return;
    }
    setApiVerificationStatus('checking');
    try {
      const ticker = await fetchTickerData('KRW-BTC');
      if (ticker && config.accessKey.length > 10 && config.secretKey.length > 10) {
        setApiVerificationStatus('success');
      } else {
        setApiVerificationStatus('fail');
      }
    } catch {
      setApiVerificationStatus('fail');
    }
  };

  const handleToggleBot = async () => {
    if (!status.isActive) {
      if (!config.accessKey || !config.secretKey) {
        setIsSettingsOpen(true);
        alert('먼저 API 설정을 완료해주세요.');
        return;
      }
      setIsStarting(true);
      try {
        const ticker = await fetchTickerData(config.coin);
        if (!ticker) throw new Error('현재가 정보를 불러올 수 없습니다.');

        const initialBuyAmount = config.initialAmount * 10000;
        const buyPrice = ticker.price;

        await placeUpbitOrder(config.coin, 'bid', 'price', initialBuyAmount);

        setStatus({
          isActive: true,
          currentStep: 1, 
          averagePrice: buyPrice,
          lastBuyPrice: buyPrice,
          totalQuantity: initialBuyAmount / buyPrice,
          totalInvested: initialBuyAmount,
          currentPrice: buyPrice,
          currentChangeRate: ticker.changeRate,
          pnlPercentage: 0,
        });
      } catch (e: any) {
        alert(e.message || '봇 시작 중 오류가 발생했습니다.');
      } finally {
        setIsStarting(false);
      }
    } else {
      setStatus(prev => ({ 
        ...prev, 
        isActive: false,
        currentStep: 0,
        pnlPercentage: 0,
        averagePrice: 0,
        totalInvested: 0,
        totalQuantity: 0,
        lastBuyPrice: 0
      }));
    }
  };

  const runBacktest = async () => {
    setIsBacktesting(true);
    setBtResult(null);
    try {
      const candles = await fetchDailyCandlesLong(config.coin, 730);
      if (!candles || candles.length === 0) throw new Error('조회된 데이터가 없습니다.');

      let balance = 0, step = 0, totalQty = 0, avgPrice = 0, lastBuyPrice = 0, trades = 0, wins = 0, losses = 0, totalInvested = 0, peak = 0, mdd = 0;
      const initialInvestedCapital = config.initialAmount * 10000;

      for (const candle of candles) {
        const low = candle.low || candle.price;
        const high = candle.high || candle.price;
        const price = candle.price;

        if (step === 0) {
          step = 1;
          totalQty = initialInvestedCapital / price;
          avgPrice = price;
          lastBuyPrice = price;
          totalInvested = initialInvestedCapital;
        } else {
          const slPrice = avgPrice * (1 - config.stopLoss / 100);
          const tpPrice = avgPrice * (1 + config.targetProfit / 100);

          if (low <= slPrice) {
            balance += (totalQty * slPrice) - totalInvested;
            trades++; losses++; step = 0; totalQty = 0; totalInvested = 0;
          } 
          else if (high >= tpPrice) {
            balance += (totalQty * tpPrice) - totalInvested;
            trades++; wins++; step = 0; totalQty = 0; totalInvested = 0;
          } 
          else {
            while (step < config.maxBuySteps) {
              const nextBuyPrice = lastBuyPrice * (1 - config.buyInterval / 100);
              if (low <= nextBuyPrice) {
                step++;
                const buyAmount = initialInvestedCapital * Math.pow(1 + config.premiumRate / 100, step - 1);
                totalQty += buyAmount / nextBuyPrice;
                totalInvested += buyAmount;
                avgPrice = totalInvested / totalQty;
                lastBuyPrice = nextBuyPrice;
              } else {
                break;
              }
            }
          }
        }
        
        const currentEquity = balance + (step > 0 ? (totalQty * price) - totalInvested : 0);
        if (currentEquity > peak) peak = currentEquity;
        const dd = peak <= 0 ? 0 : (peak - currentEquity) / peak * 100;
        if (dd > mdd) mdd = dd;
      }

      setBtResult({
        totalProfit: Math.round(balance),
        profitRate: Number(((balance / initialInvestedCapital) * 100).toFixed(2)),
        totalTrades: trades, winCount: wins, lossCount: losses, maxDrawdown: Number(mdd.toFixed(2))
      });
    } catch (e: any) {
      alert(e.message || '백테스트 중 오류 발생');
    } finally {
      setIsBacktesting(false);
    }
  };

  const filteredMarkets = markets.filter(m => 
    m.korean_name.toLowerCase().includes(coinSearch.toLowerCase()) || 
    m.market.toLowerCase().includes(coinSearch.toLowerCase())
  );

  const copyIpToClipboard = (ip: string) => {
    navigator.clipboard.writeText(ip);
    alert('IP가 복사되었습니다. 업비트 API 설정에 등록해주세요.');
  };

  const renderResultsSection = () => {
    const totalPnl = tradeHistory.reduce((acc, cur) => acc + cur.pnlAmount, 0);
    const winCount = tradeHistory.filter(h => h.exitType === 'PROFIT').length;
    const winRate = tradeHistory.length > 0 ? Math.round((winCount / tradeHistory.length) * 100) : 0;

    return (
      <main className="flex-1 p-5 space-y-5 overflow-y-auto animate-in fade-in slide-in-from-right-4 duration-300">
        <div className="flex items-center space-x-2 mb-2">
          <button onClick={() => setActiveSection('main')} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">
            <i className="fas fa-arrow-left"></i>
          </button>
          <h2 className="text-xl font-black text-slate-800">투자 결과 보고</h2>
        </div>
        <section className="bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">TOTAL PERFORMANCE</p>
          <div className="flex justify-between items-end mb-6">
            <div>
              <h3 className={`text-3xl font-black ${totalPnl >= 0 ? 'text-rose-400' : 'text-blue-400'}`}>
                {totalPnl >= 0 ? '+' : ''}{Math.round(totalPnl).toLocaleString()}
                <span className="text-sm font-medium ml-1">KRW</span>
              </h3>
            </div>
            <div className="text-right">
              <span className="text-xs font-bold text-slate-400 block">승률</span>
              <span className="text-xl font-black text-white">{winRate}%</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/5 p-4 rounded-2xl">
              <span className="text-[10px] font-bold text-slate-400 block mb-1">매매 횟수</span>
              <span className="text-lg font-bold">{tradeHistory.length}회</span>
            </div>
            <div className="bg-white/5 p-4 rounded-2xl">
              <span className="text-[10px] font-bold text-slate-400 block mb-1">누적 투자</span>
              <span className="text-lg font-bold">{Math.round(tradeHistory.reduce((acc, cur) => acc + cur.totalInvested, 0)).toLocaleString()}</span>
            </div>
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest px-1">최근 매매 내역</h3>
          {tradeHistory.length === 0 ? (
            <div className="bg-white p-10 rounded-[2rem] text-center border border-dashed border-slate-200">
              <i className="fas fa-history text-slate-200 text-4xl mb-3"></i>
              <p className="text-slate-400 font-medium">아직 완료된 매매가 없습니다.</p>
            </div>
          ) : (
            tradeHistory.map((record) => (
              <div key={record.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center transition-all hover:border-blue-100">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-black text-slate-800">{record.coinName}</span>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${record.exitType === 'PROFIT' ? 'bg-rose-50 text-rose-500' : 'bg-blue-50 text-blue-500'}`}>
                      {record.exitType === 'PROFIT' ? '익절' : '손절'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium">{record.timestamp}</p>
                </div>
                <div className="text-right">
                  <p className={`font-black ${record.pnlPercentage >= 0 ? 'text-rose-500' : 'text-blue-500'}`}>
                    {record.pnlPercentage >= 0 ? '+' : ''}{record.pnlPercentage.toFixed(2)}%
                  </p>
                  <p className="text-[11px] font-bold text-slate-500">
                    {Math.round(record.pnlAmount).toLocaleString()} KRW
                  </p>
                </div>
              </div>
            ))
          )}
        </section>
      </main>
    );
  };

  return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col bg-slate-50 relative pb-28 shadow-2xl overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-30 shadow-sm flex justify-between items-center">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center">
          <i className="fas fa-robot text-blue-600 mr-2"></i>
          Upbit <span className="text-blue-600 ml-1">Bot</span>
        </h1>
        <div className="flex items-center space-x-3">
          <button onClick={() => setIsSettingsOpen(true)} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">
            <i className="fas fa-cog"></i>
          </button>
          <div className="flex flex-col items-end">
            <span className={`h-2.5 w-2.5 rounded-full ${status.isActive ? 'bg-green-500 animate-pulse' : isNetworkError ? 'bg-amber-500 animate-bounce' : 'bg-slate-300'}`}></span>
            <span className="text-[8px] font-bold text-slate-400 uppercase">{status.isActive ? 'LIVE' : isNetworkError ? 'ERROR' : 'IDLE'}</span>
          </div>
        </div>
      </header>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-t-[2.5rem] p-8 shadow-2xl animate-in slide-in-from-bottom-full duration-300 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">API 설정 및 IP 인증</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600 p-2"><i className="fas fa-times text-xl"></i></button>
            </div>

            <div className="space-y-4 mb-6">
              <div className={`rounded-2xl p-5 border-2 transition-all ${config.useProxy ? 'bg-blue-50 border-blue-500' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center space-x-2">
                    <i className={`fas ${config.useProxy ? 'fa-network-wired text-blue-600' : 'fa-desktop text-slate-500'}`}></i>
                    <span className="text-sm font-black text-slate-700">등록할 IP 주소</span>
                  </div>
                  <button onClick={() => fetchIp(config.useProxy)} className="text-[10px] font-bold text-blue-600 bg-white border border-blue-200 px-2 py-1 rounded-md">새로고침</button>
                </div>
                
                <div className="bg-white rounded-xl p-4 mb-3 flex items-center justify-between shadow-sm border border-slate-100 group cursor-pointer" onClick={() => copyIpToClipboard(config.useProxy ? (connectionIp || '확인 필요') : publicIp)}>
                  <span className="text-lg font-black text-slate-900 tracking-tight">{config.useProxy ? (connectionIp || 'IP를 확인하세요') : publicIp}</span>
                  <i className="fas fa-copy text-slate-300 group-hover:text-blue-500 transition-colors"></i>
                </div>
                
                <div className="flex flex-col space-y-2">
                    <p className="text-[11px] text-slate-500 leading-tight">
                        <i className="fas fa-info-circle mr-1"></i>
                        {config.useProxy 
                            ? "프록시 사용 시, 위 파란색 박스의 IP를 업비트에 등록해야 주문이 가능합니다."
                            : "프록시 미사용 시, 본인 PC의 공인 IP를 등록해야 합니다."}
                    </p>
                    <a href="https://upbit.com/service_center/open_api_guide" target="_blank" className="inline-flex items-center text-[11px] font-bold text-blue-600 hover:underline">
                        업비트 API 관리 페이지 바로가기 <i className="fas fa-external-link-alt ml-1"></i>
                    </a>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                <div>
                  <span className="text-xs font-bold text-slate-700 block">프록시 서버 사용 (CORS 회피)</span>
                  <span className="text-[10px] text-slate-400">네트워크 환경에 따라 On/Off 하세요.</span>
                </div>
                <button 
                  onClick={() => {
                    const newVal = !config.useProxy;
                    handleChange('useProxy', newVal);
                    setConnectionIp(null);
                    if (newVal) fetchIp(true);
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${config.useProxy ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.useProxy ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Access Key</label>
                <input type="password" placeholder="업비트 Access Key" className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={config.accessKey} onChange={(e) => handleChange('accessKey', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Secret Key</label>
                <input type="password" placeholder="업비트 Secret Key" className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={config.secretKey} onChange={(e) => handleChange('secretKey', e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col space-y-3">
              <button onClick={verifyApi} disabled={apiVerificationStatus === 'checking'} className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center space-x-2 transition-all ${apiVerificationStatus === 'success' ? 'bg-green-50 text-green-600 border border-green-200' : apiVerificationStatus === 'fail' ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-slate-800 text-white hover:bg-slate-900'}`}>
                {apiVerificationStatus === 'checking' ? <i className="fas fa-spinner animate-spin"></i> : apiVerificationStatus === 'success' ? <i className="fas fa-check-circle"></i> : apiVerificationStatus === 'fail' ? <i className="fas fa-exclamation-circle"></i> : <i className="fas fa-plug"></i>}
                <span>{apiVerificationStatus === 'checking' ? '연결 확인 중...' : apiVerificationStatus === 'success' ? '연결 성공' : apiVerificationStatus === 'fail' ? '연결 실패' : 'API 연결 확인'}</span>
              </button>
              <button onClick={() => setIsSettingsOpen(false)} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-100">설정 저장 및 닫기</button>
            </div>
          </div>
        </div>
      )}

      {activeSection === 'main' ? (
        <main className="flex-1 p-5 space-y-5 overflow-y-auto animate-in fade-in slide-in-from-left-4 duration-300">
          <section className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 transition-all duration-300">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">{status.isActive ? 'LIVE TRADING' : 'MARKET PREVIEW'}</p>
                <h2 className={`text-2xl font-black transition-colors duration-300 ${priceFlash === 'up' ? 'text-rose-500' : priceFlash === 'down' ? 'text-blue-500' : 'text-slate-900'}`}>
                  {status.currentPrice > 0 ? status.currentPrice.toLocaleString() : '---'}
                  <span className="text-sm font-medium ml-1">KRW</span>
                </h2>
                <div className="flex items-center mt-1 space-x-2">
                  <span className="text-xs font-bold text-slate-500">{currentCoinName}</span>
                  <span className={`text-xs font-bold ${status.currentChangeRate && status.currentChangeRate >= 0 ? 'text-rose-500' : 'text-blue-500'}`}>
                    {status.currentChangeRate && status.currentChangeRate >= 0 ? '▲' : '▼'} {Math.abs(status.currentChangeRate || 0).toFixed(2)}%
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end space-y-2">
                {status.isActive && (
                  <div className={`px-4 py-2 rounded-2xl text-sm font-black ${status.pnlPercentage >= 0 ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                    PnL: {status.pnlPercentage >= 0 ? '+' : ''}{status.pnlPercentage.toFixed(2)}%
                  </div>
                )}
                <button onClick={() => setActiveSection('results')} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase flex items-center space-x-1 transition-all active:scale-95">
                  <i className="fas fa-file-invoice-dollar"></i>
                  <span>투자결과보고</span>
                </button>
              </div>
            </div>
            <div className="flex space-x-1 bg-slate-50 p-1 rounded-xl mb-4">
              {['live', 'days', 'weeks', 'months'].map((tab) => (
                <button key={tab} onClick={() => setViewType(tab as any)} className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${viewType === tab ? 'bg-white text-blue-600 shadow-sm border border-blue-100' : 'text-slate-400 hover:text-slate-600'}`}>
                  {tab === 'live' ? '실시간' : tab === 'days' ? '일봉' : tab === 'weeks' ? '주봉' : '월봉'}
                </button>
              ))}
            </div>
            <div className="h-36 w-full mb-6 relative">
              <ResponsiveContainer width="100%" height="100%">
                {viewType === 'live' ? (
                  <LineChart data={priceHistory}>
                    <Line type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={3} dot={false} isAnimationActive={false} />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} labelStyle={{ display: 'none' }} />
                  </LineChart>
                ) : (
                  <AreaChart data={candleHistory}>
                    <defs><linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs>
                    <Area type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorPrice)" />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-4 rounded-2xl">
                <span className="text-[10px] font-bold text-slate-400 block mb-1">매수 단계</span>
                <span className="text-lg font-bold text-slate-800">{status.isActive ? `${status.currentStep} / ${config.maxBuySteps}` : '-'}</span>
              </div>
              <div className="bg-slate-50 p-4 rounded-2xl">
                <span className="text-[10px] font-bold text-slate-400 block mb-1">평균 단가</span>
                <span className="text-lg font-bold text-slate-800">{status.isActive && status.averagePrice > 0 ? Math.round(status.averagePrice).toLocaleString() : '-'}</span>
              </div>
            </div>
          </section>

          {btResult && (
            <section className="bg-slate-800 p-6 rounded-[2rem] text-white space-y-4 animate-in fade-in duration-300">
              <div className="flex justify-between items-center border-b border-white/10 pb-2">
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">백테스트 결과 (2년)</h3>
                <button onClick={() => setBtResult(null)} className="text-xs text-white/50">닫기</button>
              </div>
              <div className="grid grid-cols-2 gap-y-4 gap-x-6">
                <div><span className="text-[10px] text-slate-400 block mb-0.5">최종 수익</span><span className={`text-xl font-black ${btResult.totalProfit >= 0 ? 'text-rose-400' : 'text-blue-400'}`}>{btResult.totalProfit.toLocaleString()} KRW</span></div>
                <div><span className="text-[10px] text-slate-400 block mb-0.5">수익률</span><span className={`text-xl font-black ${btResult.profitRate >= 0 ? 'text-rose-400' : 'text-blue-400'}`}>{btResult.profitRate}%</span></div>
                <div><span className="text-[10px] text-slate-400 block mb-0.5">매매 횟수</span><span className="text-lg font-bold">{btResult.totalTrades}회</span></div>
                <div><span className="text-[10px] text-slate-400 block mb-0.5">승률</span><span className="text-lg font-bold">{btResult.totalTrades > 0 ? Math.round((btResult.winCount / btResult.totalTrades) * 100) : 0}%</span></div>
                <div className="col-span-2 bg-white/5 p-3 rounded-xl flex justify-between items-center"><span className="text-xs text-slate-300 font-bold uppercase">MDD</span><span className="text-rose-400 font-black">{btResult.maxDrawdown}%</span></div>
              </div>
            </section>
          )}

          <section className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 space-y-6">
            <div className="flex items-center justify-between pb-2 border-b border-slate-50">
              <div className="flex items-center space-x-2"><i className="fas fa-sliders-h text-blue-500"></i><h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">Strategy Config</h2></div>
              <button onClick={runBacktest} disabled={isBacktesting} className="text-[10px] font-black bg-slate-900 text-white px-3 py-1.5 rounded-full flex items-center space-x-1 active:scale-95 transition-all">
                {isBacktesting ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-vial"></i>}
                <span>2년 백테스트</span>
              </button>
            </div>
            <div className="relative" ref={searchRef}>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center"><i className="fas fa-coins mr-2 text-blue-500"></i>대상 코인 (한글 검색)</label>
              <input type="text" placeholder={status.isActive ? currentCoinName : "한글 코인명 입력"} className={`w-full bg-white border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm ${status.isActive ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`} value={coinSearch} onChange={(e) => setCoinSearch(e.target.value)} onFocus={() => !status.isActive && setShowCoinResults(true)} disabled={status.isActive} />
              {showCoinResults && !status.isActive && (
                <div className="absolute z-50 left-0 right-0 mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl max-h-60 overflow-y-auto">
                  {filteredMarkets.map((m) => (
                    <button key={m.market} onClick={() => { handleChange('coin', m.market); setCoinSearch(''); setShowCoinResults(false); }} className="w-full text-left px-5 py-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 flex justify-between items-center">
                      <div><span className="font-bold text-slate-800">{m.korean_name}</span><span className="text-xs text-slate-400 ml-2">{m.market.split('-')[1]}</span></div>
                      {config.coin === m.market && <i className="fas fa-check text-blue-500 text-xs"></i>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <InputGroup label="분할 횟수" icon="fa-layer-group" type="number" value={config.maxBuySteps} onChange={(e) => handleChange('maxBuySteps', parseInt(e.target.value))} unit="회" />
              <InputGroup label="하락 간격" icon="fa-chart-line-down" type="number" step={0.1} value={config.buyInterval} onChange={(e) => handleChange('buyInterval', parseFloat(e.target.value))} unit="%" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <InputGroup label="목표 수익" icon="fa-bullseye" type="number" step={0.1} value={config.targetProfit} onChange={(e) => handleChange('targetProfit', parseFloat(e.target.value))} unit="%" />
              <InputGroup label="손절 라인" icon="fa-hand-holding-dollar" type="number" step={0.1} value={config.stopLoss} onChange={(e) => handleChange('stopLoss', parseFloat(e.target.value))} unit="%" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <InputGroup label="시작 금액" icon="fa-won-sign" type="number" value={config.initialAmount} onChange={(e) => handleChange('initialAmount', parseInt(e.target.value))} unit="만" />
              <InputGroup label="매수 할증" icon="fa-plus-circle" type="number" step={0.1} value={config.premiumRate} onChange={(e) => handleChange('premiumRate', parseFloat(e.target.value))} unit="%" />
            </div>
          </section>
        </main>
      ) : (
        renderResultsSection()
      )}

      <footer className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-6 bg-white/80 backdrop-blur-xl border-t border-slate-100 z-40">
        <button onClick={handleToggleBot} disabled={isStarting} className={`w-full py-5 rounded-[1.5rem] font-black text-lg shadow-xl transition-all active:scale-[0.96] flex items-center justify-center space-x-3 ${status.isActive ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-blue-600 text-white shadow-blue-200'} ${isStarting ? 'opacity-70' : ''}`}>
          {isStarting ? <i className="fas fa-spinner animate-spin"></i> : status.isActive ? <><i className="fas fa-pause-circle"></i><span>봇 가동 중단하기</span></> : <><i className="fas fa-play-circle"></i><span>자동매매 시작하기</span></>}
        </button>
      </footer>
    </div>
  );
};

export default App;

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
