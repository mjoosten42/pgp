export const HOST: string = process.env.HOST;
export const DB_PORT: number = Number(process.env.DB_PORT);
export const DB_USER: string = process.env.DB_USER;
export const DB_PASS: string = process.env.DB_PASS;
export const BACKEND_PORT: number = Number(process.env.BACKEND_PORT);
export const BACKEND_ADDRESS: string = 'http://' + process.env.HOST + ':' + process.env.BACKEND_PORT;
export const FRONTEND_ADDRESS: string = 'http://' + process.env.HOST + ':' + process.env.FRONTEND_PORT;
export const SESSION_SECRET: string = process.env.SESSION_SECRET;
