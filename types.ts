
export interface TradingConfig {
  accessKey: string;
  secretKey: string;
  coin: string;
  maxBuySteps: number;
  buyInterval: number;
  targetProfit: number;
  stopLoss: number;
  initialAmount: number;
  premiumRate: number;
  useProxy: boolean; // 프록시 사용 여부 추가
}

export interface TradeStatus {
  isActive: boolean;
  currentStep: number;
  averagePrice: number;
  totalQuantity: number;
  totalInvested: number;
  currentPrice: number;
  pnlPercentage: number;
  currentChangeRate?: number;
}

export interface CoinInfo {
  market: string;
  korean_name: string;
  english_name: string;
}

export interface TradeRecord {
  id: string;
  timestamp: string;
  coin: string;
  coinName: string;
  exitType: 'PROFIT' | 'LOSS';
  pnlPercentage: number;
  pnlAmount: number;
  totalInvested: number;
  finalStep: number;
}
