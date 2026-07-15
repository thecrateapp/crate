"""Redis Lua scripts for atomic federation quota accounting."""

ACQUIRE_SLOT_LUA = """
-- CRATE_ACQUIRE_SLOT_V1
local now = tonumber(ARGV[1])
local expires_at = tonumber(ARGV[2])
local stream_id = ARGV[3]
local max_peer = tonumber(ARGV[4])
local max_subject = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZSCORE', KEYS[1], stream_id) then
  redis.call('ZADD', KEYS[1], expires_at, stream_id)
  redis.call('ZADD', KEYS[2], expires_at, stream_id)
  return {1, 'reused'}
end
if redis.call('ZCARD', KEYS[1]) >= max_peer then
  return {0, 'peer_stream_limit'}
end
if redis.call('ZCARD', KEYS[2]) >= max_subject then
  return {0, 'subject_stream_limit'}
end
redis.call('ZADD', KEYS[1], expires_at, stream_id)
redis.call('ZADD', KEYS[2], expires_at, stream_id)
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('PEXPIRE', KEYS[2], ttl)
return {1, 'ok'}
"""

RELEASE_SLOT_LUA = """
-- CRATE_RELEASE_SLOT_V1
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
"""

RESERVE_BYTES_LUA = """
-- CRATE_RESERVE_BYTES_V1
local requested = tonumber(ARGV[1])
local peer_limit = tonumber(ARGV[2])
local subject_limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local peer_current = tonumber(redis.call('GET', KEYS[1]) or '0')
local subject_current = tonumber(redis.call('GET', KEYS[2]) or '0')
if peer_current + requested > peer_limit then
  return {0, 'peer_byte_quota'}
end
if subject_current + requested > subject_limit then
  return {0, 'subject_byte_quota'}
end
redis.call('INCRBY', KEYS[1], requested)
redis.call('INCRBY', KEYS[2], requested)
redis.call('EXPIRE', KEYS[1], ttl)
redis.call('EXPIRE', KEYS[2], ttl)
return {1, 'ok'}
"""

RECONCILE_BYTES_LUA = """
-- CRATE_RECONCILE_BYTES_V1
local adjustment = tonumber(ARGV[1])
for _, key in ipairs(KEYS) do
  local current = tonumber(redis.call('GET', key) or '0')
  local updated = current + adjustment
  if updated < 0 then updated = 0 end
  redis.call('SET', key, updated, 'EX', tonumber(ARGV[2]))
end
return 1
"""
