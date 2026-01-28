// src/lib/config/jq.ts
// JQ filter limits for DoS prevention

import { MAX_RESPONSE_SIZE } from "./limits.js";

export const MAX_JQ_FILTER_LENGTH = 500;
export const MAX_JQ_TOKENS = 50;
export const MAX_JQ_FILTERS = 20;
export const MAX_JQ_PARSE_TIME_MS = 100;
export const MAX_JQ_QUERY_FILE_SIZE = MAX_RESPONSE_SIZE; // 10MB
