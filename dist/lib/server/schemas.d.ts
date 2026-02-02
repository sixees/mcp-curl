import { z } from "zod";
/**
 * Schema for structured cURL execution.
 * Validates all parameters for the curl_execute tool.
 */
export declare const CurlExecuteSchema: z.ZodObject<{
    url: z.ZodEffects<z.ZodString, string, string>;
    method: z.ZodOptional<z.ZodEnum<["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    data: z.ZodOptional<z.ZodString>;
    form: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    follow_redirects: z.ZodDefault<z.ZodBoolean>;
    max_redirects: z.ZodOptional<z.ZodNumber>;
    insecure: z.ZodDefault<z.ZodBoolean>;
    timeout: z.ZodDefault<z.ZodNumber>;
    user_agent: z.ZodOptional<z.ZodString>;
    basic_auth: z.ZodOptional<z.ZodString>;
    bearer_token: z.ZodOptional<z.ZodString>;
    verbose: z.ZodDefault<z.ZodBoolean>;
    include_headers: z.ZodDefault<z.ZodBoolean>;
    compressed: z.ZodDefault<z.ZodBoolean>;
    include_metadata: z.ZodDefault<z.ZodBoolean>;
    jq_filter: z.ZodOptional<z.ZodString>;
    max_result_size: z.ZodOptional<z.ZodNumber>;
    save_to_file: z.ZodOptional<z.ZodBoolean>;
    output_dir: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    url: string;
    follow_redirects: boolean;
    insecure: boolean;
    timeout: number;
    verbose: boolean;
    include_headers: boolean;
    compressed: boolean;
    include_metadata: boolean;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | undefined;
    headers?: Record<string, string> | undefined;
    data?: string | undefined;
    form?: Record<string, string> | undefined;
    max_redirects?: number | undefined;
    user_agent?: string | undefined;
    basic_auth?: string | undefined;
    bearer_token?: string | undefined;
    jq_filter?: string | undefined;
    max_result_size?: number | undefined;
    save_to_file?: boolean | undefined;
    output_dir?: string | undefined;
}, {
    url: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | undefined;
    headers?: Record<string, string> | undefined;
    data?: string | undefined;
    form?: Record<string, string> | undefined;
    follow_redirects?: boolean | undefined;
    max_redirects?: number | undefined;
    insecure?: boolean | undefined;
    timeout?: number | undefined;
    user_agent?: string | undefined;
    basic_auth?: string | undefined;
    bearer_token?: string | undefined;
    verbose?: boolean | undefined;
    include_headers?: boolean | undefined;
    compressed?: boolean | undefined;
    include_metadata?: boolean | undefined;
    jq_filter?: string | undefined;
    max_result_size?: number | undefined;
    save_to_file?: boolean | undefined;
    output_dir?: string | undefined;
}>;
/** Inferred TypeScript type from CurlExecuteSchema */
export type CurlExecuteInput = z.infer<typeof CurlExecuteSchema>;
/**
 * Schema for jq_query tool (query JSON files without HTTP requests).
 */
export declare const JqQuerySchema: z.ZodObject<{
    filepath: z.ZodString;
    jq_filter: z.ZodString;
    max_result_size: z.ZodOptional<z.ZodNumber>;
    save_to_file: z.ZodOptional<z.ZodBoolean>;
    output_dir: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    jq_filter: string;
    filepath: string;
    max_result_size?: number | undefined;
    save_to_file?: boolean | undefined;
    output_dir?: string | undefined;
}, {
    jq_filter: string;
    filepath: string;
    max_result_size?: number | undefined;
    save_to_file?: boolean | undefined;
    output_dir?: string | undefined;
}>;
/** Inferred TypeScript type from JqQuerySchema */
export type JqQueryInput = z.infer<typeof JqQuerySchema>;
