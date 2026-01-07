
import { CoinInfo } from '../types';
import CryptoJS from 'crypto-js';

// Add missing interfaces for API responses
export interface TickerData {
  price: number;
  changeRate: number;
}

export interface CandleData {
  time: string;
  price: number;
  high?: number;
  low?: number;
  opening?: number;
}

const PROXY_URLS = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

/**
 * 업비트 표준 Base64Url 인코딩
 */
function base64UrlEncode(source: CryptoJS.lib.WordArray | string): string {
  let encoded = typeof source === 'string' 
    ? CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(source))
    : CryptoJS.enc.Base64.stringify(source);
  
  return encoded
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * 업비트 JWT 토큰 생성 함수
 */
function generateToken(accessKey: string, secretKey: string, query?: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  
  const payload: any = {
    access_key: accessKey,
    nonce: Date.now().toString() + Math.random().toString(36).substring(2, 10),
    timestamp: Date.now(),
  };

  if (query) {
    const queryHash = CryptoJS.SHA512(query).toString(CryptoJS.enc.Hex);
    payload.query_hash = queryHash;
    payload.query_hash_alg = 'SHA512';
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = CryptoJS.HmacSHA256(unsignedToken, secretKey);
  const encodedSignature = base64UrlEncode(signature);

  return `Bearer ${unsignedToken}.${encodedSignature}`;
}

/**
 * 설정에 따라 프록시 사용 여부 결정
 */
async function fetchWithProxy(targetUrl: string, options: RequestInit = {}): Promise<Response> {
  const savedConfig = localStorage.getItem('upbit_bot_config_v2');
  let useProxy = true;
  
  if (savedConfig) {
    const config = JSON.parse(savedConfig);
    useProxy = config.useProxy !== undefined ? config.useProxy : true;
  }

  try {
    const url = useProxy 
      ? `${PROXY_URLS[0]}${encodeURIComponent(targetUrl)}` 
      : targetUrl;
      
    const response = await fetch(url, options);
    return response;
  } catch (e: any) {
    if (!useProxy) {
      throw new Error('직접 연결 실패: 브라우저의 CORS 제한 때문일 수 있습니다. 프록시를 켜거나 "Allow CORS" 확장 프로그램을 사용하세요.');
    }
    throw e;
  }
}

/**
 * 실제 업비트 주문 실행
 */
export const placeUpbitOrder = async (
  market: string, 
  side: 'bid' | 'ask', 
  ord_type: 'limit' | 'price' | 'market',
  amount_or_price: number,
  volume?: number
) => {
  const savedConfig = localStorage.getItem('upbit_bot_config_v2');
  if (!savedConfig) throw new Error('API 설정이 없습니다.');
  const { accessKey, secretKey } = JSON.parse(savedConfig);

  const body: any = { market, side, ord_type };
  
  if (ord_type === 'price') {
    body.price = Math.floor(amount_or_price).toString();
  } else if (ord_type === 'market') {
    body.volume = volume?.toString();
  } else {
    body.price = amount_or_price.toString();
    body.volume = volume?.toString();
  }

  const sortedKeys = Object.keys(body).sort();
  const queryString = sortedKeys
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(body[key])}`)
    .join('&');

  const token = generateToken(accessKey, secretKey, queryString);
  const targetUrl = 'https://api.upbit.com/v1/orders';

  try {
    const response = await fetchWithProxy(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify(body)
    });

    const result = await response.json();
    
    if (!response.ok) {
      const errorMsg = result.error?.message || `HTTP ${response.status}`;
      const errorName = result.error?.name || '';

      if (errorName === 'invalid_ip' || errorMsg.includes('IP')) {
        throw new Error(`[IP 인증 오류] 업비트에 등록된 IP가 아닙니다. 설정 메뉴에서 '업비트가 인식할 IP'를 확인하고 등록해주세요.`);
      }
      throw new Error(`업비트 오류: ${errorMsg} (${errorName})`);
    }

    return { success: true, ...result };
  } catch (error: any) {
    throw error;
  }
};

export const fetchMarketList = async (): Promise<CoinInfo[]> => {
  const targetUrl = 'https://api.upbit.com/v1/market/all?isDetails=false';
  try {
    const response = await fetchWithProxy(targetUrl);
    const data = await response.json();
    return Array.isArray(data) ? data.filter((item: CoinInfo) => item.market.startsWith('KRW-')) : [];
  } catch (error) {
    return [
      { market: 'KRW-BTC', korean_name: '비트코인', english_name: 'Bitcoin' },
      { market: 'KRW-ETH', korean_name: '이더리움', english_name: 'Ethereum' },
    ];
  }
};

export const fetchTickerData = async (market: string): Promise<TickerData | null> => {
  const targetUrl = `https://api.upbit.com/v1/ticker?markets=${market}`;
  try {
    const response = await fetchWithProxy(targetUrl);
    const data = await response.json();
    const actualData = Array.isArray(data) ? data : [];

    if (actualData && actualData[0]) {
      return {
        price: actualData[0].trade_price,
        changeRate: actualData[0].signed_change_rate * 100
      };
    }
    return null;
  } catch (error) {
    return null;
  }
};

export const fetchCandles = async (market: string, type: 'days' | 'weeks' | 'months'): Promise<CandleData[]> => {
  const targetUrl = `https://api.upbit.com/v1/candles/${type}?market=${market}&count=50`;
  try {
    const response = await fetchWithProxy(targetUrl);
    const data = await response.json();
    const actualData = Array.isArray(data) ? data : [];
    return actualData.map((c: any) => ({
      time: c.candle_date_time_kst.split('T')[0],
      price: c.trade_price
    })).reverse();
  } catch (error) {
    return [];
  }
};

export const fetchDailyCandlesLong = async (market: string, days: number = 730): Promise<CandleData[]> => {
  let allCandles: any[] = [];
  let to = '';
  const batchSize = 200;

  try {
    while (allCandles.length < days) {
      const targetUrl = `https://api.upbit.com/v1/candles/days?market=${market}&count=${batchSize}${to ? `&to=${to}` : ''}`;
      const response = await fetchWithProxy(targetUrl);
      const data = await response.json();
      const actualData = Array.isArray(data) ? data : [];
      
      if (!actualData || actualData.length === 0) break;
      
      allCandles = [...allCandles, ...actualData];
      to = actualData[actualData.length - 1].candle_date_time_utc;
      
      if (actualData.length < batchSize) break;
      await new Promise(r => setTimeout(r, 500));
    }

    return allCandles.map((c: any) => ({
      time: c.candle_date_time_kst,
      price: c.trade_price,
      high: c.high_price,
      low: c.low_price,
      opening: c.opening_price
    })).slice(0, days).reverse();
  } catch (error) {
    return [];
  }
};
