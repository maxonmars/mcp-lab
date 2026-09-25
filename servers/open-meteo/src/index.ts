export {
  type AdviceModelOptions,
  type AdviceRequest,
  createDeepSeekAdvice,
  type GenerateAdvice,
} from "./outfit/deepseek.ts";
export { createWeatherServer, SERVER_NAME, SERVER_VERSION } from "./server/createServer.ts";
export {
  type OutfitDependencies,
  RECOMMEND_OUTFIT_TOOL_NAME,
  SAVE_OUTFIT_ADVICE_TOOL_NAME,
} from "./server/outfitTools.ts";
export { GET_CURRENT_WEATHER_TOOL_NAME } from "./server/weatherTool.ts";
export { OPEN_METEO_TIMEOUT_MS } from "./weather/constants.ts";
export type { WeatherSnapshot } from "./weather/snapshot.ts";
export type { WeatherDependencies } from "./weather/types.ts";
