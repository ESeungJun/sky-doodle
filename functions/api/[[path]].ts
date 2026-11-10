import { fail, type Env } from '../_lib.ts'

/** 정의하지 않은 /api 경로는 index.html 이 아니라 404 JSON 으로 답한다. */
export const onRequest: PagesFunction<Env> = () => fail(404, 'not_found')
