export const GET_CURRENT_WEATHER = "get_current_weather";
export const RECOMMEND_OUTFIT = "recommend_outfit";
export const SAVE_OUTFIT_ADVICE = "save_outfit_advice";
export const PREPARE_OUTFIT_ADVICE = "prepare_outfit_advice";

/** Шаги пайплайна, скрытые от Agent: он видит только фасад. */
export const INTERNAL_TOOLS: ReadonlySet<string> = new Set([RECOMMEND_OUTFIT, SAVE_OUTFIT_ADVICE]);
