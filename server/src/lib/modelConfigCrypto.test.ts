import assert from "node:assert/strict";
import test from "node:test";
import { encryptModelConfigSecret, decryptModelConfigSecret, apiKeyLast4 } from "./modelConfigCrypto";

test("encrypt then decrypt returns the original value", () => {
  const secret = "sk-test-key-1234567890";
  const encrypted = encryptModelConfigSecret(secret);
  const decrypted = decryptModelConfigSecret(encrypted);
  assert.equal(decrypted, secret);
});

test("encrypted output is base64 and different from plaintext", () => {
  const secret = "my-api-key";
  const encrypted = encryptModelConfigSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.doesNotThrow(() => Buffer.from(encrypted, "base64"));
});

test("two encryptions of the same value produce different ciphertexts", () => {
  const secret = "same-key-twice";
  const a = encryptModelConfigSecret(secret);
  const b = encryptModelConfigSecret(secret);
  assert.notEqual(a, b);
});

test("decrypt with corrupted ciphertext throws", () => {
  const encrypted = encryptModelConfigSecret("valid-key");
  const corrupted = encrypted.slice(0, -4) + "XXXX";
  assert.throws(() => decryptModelConfigSecret(corrupted));
});

test("encrypt and decrypt handles empty string", () => {
  const encrypted = encryptModelConfigSecret("");
  const decrypted = decryptModelConfigSecret(encrypted);
  assert.equal(decrypted, "");
});

test("encrypt and decrypt handles unicode", () => {
  const secret = "密钥-🔑-키";
  const encrypted = encryptModelConfigSecret(secret);
  const decrypted = decryptModelConfigSecret(encrypted);
  assert.equal(decrypted, secret);
});

test("apiKeyLast4 returns last 4 characters", () => {
  assert.equal(apiKeyLast4("sk-1234567890abcdef"), "cdef");
});

test("apiKeyLast4 handles short strings", () => {
  assert.equal(apiKeyLast4("abc"), "abc");
  assert.equal(apiKeyLast4("ab"), "ab");
  assert.equal(apiKeyLast4(""), "");
});
