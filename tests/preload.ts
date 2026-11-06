import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = join(tmpdir(), `alimpay-bun-tests-${process.pid}`);
process.env.APP_MASTER_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
process.env.PUBLIC_BASE_URL = "http://localhost";
