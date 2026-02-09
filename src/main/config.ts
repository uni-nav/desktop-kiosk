// src/main/config.ts - Environment Configuration
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logger } from './logger';

const normalizeApiUrl = (raw: string): string => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return defaults.API_URL;
    let url = trimmed;
    if (!/^https?:\/\//i.test(url)) {
        url = `http://${url}`;
    }
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/api$/i, '');
    return url;
};

const parseIntOrDefault = (raw: string, fallback: number): number => {
    const n = parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : fallback;
};

const parseBool = (raw: string, fallback: boolean): boolean => {
    const s = String(raw);
    if (s === 'true') return true;
    if (s === 'false') return false;
    return fallback;
};

// Default values
const defaults = {
    API_URL: 'http://3.77.140.158:8000',
    KIOSK_ID: '0',
    KIOSK_MODE: 'false',
    AUTO_FULLSCREEN: 'false',
    IDLE_TIMEOUT_MS: '300000', // 5 minutes
    ANIMATION_LOOPS: '3',
    DEBUG_MODE: 'false',
    SETUP_COMPLETED: 'false'
};

interface Config {
    API_URL: string;
    KIOSK_ID: number;
    KIOSK_MODE: boolean;
    AUTO_FULLSCREEN: boolean;
    IDLE_TIMEOUT_MS: number;
    ANIMATION_LOOPS: number;
    DEBUG_MODE: boolean;
    SETUP_COMPLETED: boolean;
}

let config: Config | null = null;

/**
 * Load configuration from multiple sources:
 * 1. Environment variables (highest priority)
 * 2. .env file in app directory
 * 3. config.json in userData directory (persistent config)
 * 4. Default values (lowest priority)
 */
export function loadConfig(): Config {
    if (config) return config;

    const values: Record<string, string> = { ...defaults };

    // Load from .env file (if exists - mostly for dev)
    const envPath = path.join(app.getAppPath(), '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
                values[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
            }
        });
    }

    // Load from config.json in userData (User settings - Highest priority for Setup Wizard)
    const configJsonPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configJsonPath)) {
        try {
            const jsonConfig = JSON.parse(fs.readFileSync(configJsonPath, 'utf-8'));
            // Start with defaults + env
            // Then overwrite with JSON config (user settings)
            Object.assign(values, jsonConfig);
        } catch (err) {
            logger.config.missing('config.json parse error');
        }
    }

    // Override with force environment variables (if any provided via command line)
    Object.keys(defaults).forEach(key => {
        if (process.env[key]) {
            values[key] = process.env[key]!;
        }
    });

    // Parse config
    config = {
        API_URL: normalizeApiUrl(values.API_URL),
        KIOSK_ID: parseIntOrDefault(values.KIOSK_ID, parseIntOrDefault(defaults.KIOSK_ID, 0)),
        KIOSK_MODE: parseBool(values.KIOSK_MODE, defaults.KIOSK_MODE === 'true'),
        AUTO_FULLSCREEN: parseBool(values.AUTO_FULLSCREEN, defaults.AUTO_FULLSCREEN === 'true'),
        IDLE_TIMEOUT_MS: parseIntOrDefault(values.IDLE_TIMEOUT_MS, parseIntOrDefault(defaults.IDLE_TIMEOUT_MS, 300000)),
        ANIMATION_LOOPS: parseIntOrDefault(values.ANIMATION_LOOPS, parseIntOrDefault(defaults.ANIMATION_LOOPS, 3)),
        DEBUG_MODE: parseBool(values.DEBUG_MODE, defaults.DEBUG_MODE === 'true'),
        SETUP_COMPLETED: parseBool(values.SETUP_COMPLETED, defaults.SETUP_COMPLETED === 'true')
    };

    const env = process.env.NODE_ENV || 'development';
    logger.config.loaded(env, `${config.API_URL} (Setup: ${config.SETUP_COMPLETED})`);

    return config;
}

/**
 * Save config to config.json (for remote updates)
 */
export function saveConfig(newConfig: Partial<Config>): void {
    const configJsonPath = path.join(app.getPath('userData'), 'config.json');
    const current = loadConfig();
    const updated = { ...current, ...newConfig };
    fs.writeFileSync(configJsonPath, JSON.stringify(updated, null, 2));
    config = null; // Reset to reload
    logger.info('⚙️ [CONFIG] Configuration updated and saved');
}

/**
 * Get current config
 */
export function getConfig(): Config {
    return loadConfig();
}

export default { loadConfig, saveConfig, getConfig };
