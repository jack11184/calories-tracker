-- ============================================
-- Calories Tracker Database Schema (PostgreSQL)
-- ============================================

-- 1. Users table - authentication
CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(50)  UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,  -- bcrypt hash
    created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- 2. Profiles table - each user can have multiple profiles (Me, Bulk, Cut, etc.)
CREATE TABLE profiles (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    goal        INTEGER      DEFAULT 2000,
    protein_goal INTEGER     DEFAULT NULL,
    carbs_goal  INTEGER      DEFAULT NULL,
    fat_goal    INTEGER      DEFAULT NULL,
    is_active   BOOLEAN      DEFAULT FALSE,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- 3. Plan stats - TDEE / cutting / bulking calculator data
CREATE TABLE plan_stats (
    id          SERIAL PRIMARY KEY,
    profile_id  INTEGER UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    sex         VARCHAR(10)  NOT NULL,
    age         INTEGER      NOT NULL,
    ft          INTEGER      NOT NULL,
    inches      INTEGER      NOT NULL,
    lbs         NUMERIC(6,2) NOT NULL,
    activity    NUMERIC(4,2) NOT NULL
);

-- 4. Food entries - daily food log
CREATE TABLE food_entries (
    id          SERIAL PRIMARY KEY,
    profile_id  INTEGER      NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    entry_date  DATE         NOT NULL,
    entry_time  VARCHAR(5)   NOT NULL,  -- HH:MM
    name        VARCHAR(255) NOT NULL,
    calories    INTEGER      NOT NULL,
    protein     NUMERIC(7,2) DEFAULT NULL,
    carbs       NUMERIC(7,2) DEFAULT NULL,
    fat         NUMERIC(7,2) DEFAULT NULL,
    created_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_food_entries_profile_date ON food_entries(profile_id, entry_date);

-- 5. Recent foods - last 10 foods added per profile
CREATE TABLE recent_foods (
    id            SERIAL PRIMARY KEY,
    profile_id    INTEGER      NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name          VARCHAR(255) NOT NULL,
    brand         VARCHAR(100) DEFAULT 'Built-in',
    kcal_per_100g INTEGER      NOT NULL,
    protein       NUMERIC(7,2) DEFAULT NULL,
    carbs         NUMERIC(7,2) DEFAULT NULL,
    fat           NUMERIC(7,2) DEFAULT NULL,
    added_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_recent_foods_profile ON recent_foods(profile_id);

-- 6. Favorite foods - starred foods per profile
CREATE TABLE favorite_foods (
    id            SERIAL PRIMARY KEY,
    profile_id    INTEGER      NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name          VARCHAR(255) NOT NULL,
    brand         VARCHAR(100) DEFAULT 'Built-in',
    kcal_per_100g INTEGER      NOT NULL,
    protein       NUMERIC(7,2) DEFAULT NULL,
    carbs         NUMERIC(7,2) DEFAULT NULL,
    fat           NUMERIC(7,2) DEFAULT NULL,
    UNIQUE(profile_id, name)
);

CREATE INDEX idx_favorite_foods_profile ON favorite_foods(profile_id);

-- 7. USDA API key storage per user (optional)
ALTER TABLE users ADD COLUMN usda_api_key VARCHAR(100) DEFAULT NULL;

-- ============================================
-- Create a default profile trigger
-- When a user registers, auto-create a "Me" profile
-- ============================================
CREATE OR REPLACE FUNCTION create_default_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (user_id, name, goal, is_active)
    VALUES (NEW.id, 'Me', 2000, TRUE);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_user_insert
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION create_default_profile();
