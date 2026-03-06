// Generic API responses
export type ApiError = {
  error: string;
  message: string;
  statusCode: number;
};

export type ApiSuccess<T = unknown> = {
  success: true;
  data: T;
};
