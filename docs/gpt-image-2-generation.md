# Aizahuo gpt-image-2 生图调用方法

这份文档只说明如何调用 `aizahuo.shop` 的 `gpt-image-2` 生图。重点：不要按普通 `/images/generations` 调；Aizahuo 这里要走 `/responses`，用 `image_generation` tool 调 `gpt-image-2`。

## 1. 请求地址

如果你的 Aizahuo base URL 是：

```text
https://aizahuo.shop/v1
```

生图请求地址是：

```text
POST https://aizahuo.shop/v1/responses
```

请求头：

```http
Authorization: Bearer <AIZAHUO_API_KEY>
Content-Type: application/json
```

## 2. 最小文本生图请求

```json
{
  "model": "gpt-5.5",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "A cinematic 3D American comic style scene, a blue circle on a clean white background, high detail"
        }
      ]
    }
  ],
  "stream": false,
  "tool_choice": { "type": "image_generation" },
  "tools": [
    {
      "type": "image_generation",
      "model": "gpt-image-2",
      "size": "1024x1024",
      "quality": "high",
      "output_format": "png"
    }
  ]
}
```

关键点：

- 外层 `model` 不是 `gpt-image-2`，而是 Responses 对话模型，当前可用 `gpt-5.5`。
- 真正的生图模型写在 `tools[0].model`: `gpt-image-2`。
- `prompt` 不放在顶层，必须放到 `input[0].content` 的 `input_text` 里。
- `stream` 建议固定 `false`。
- `tool_choice` 必须指定 `{ "type": "image_generation" }`。

## 3. 带参考图的请求

参考图也放在 `input[0].content` 里，类型是 `input_image`。

```json
{
  "model": "gpt-5.5",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Use the reference image as the character identity. Generate a cinematic 16:9 shot in the same 3D American comic style."
        },
        {
          "type": "input_image",
          "image_url": "https://example.com/reference-character.png"
        }
      ]
    }
  ],
  "stream": false,
  "tool_choice": { "type": "image_generation" },
  "tools": [
    {
      "type": "image_generation",
      "model": "gpt-image-2",
      "size": "2048x1152",
      "quality": "high",
      "output_format": "png"
    }
  ]
}
```

多个参考图就继续追加多个 `input_image`：

```json
{
  "type": "input_image",
  "image_url": "https://example.com/ref-2.png"
}
```

不要用这些字段传参考图：

```json
{
  "image_urls": ["..."],
  "reference_images": ["..."],
  "images": [{ "image_url": "..." }]
}
```

这些是别的接口/供应商常见写法，但 Aizahuo 的 `/responses + image_generation` 应该用 `input_image`。

## 4. 尺寸写法

Aizahuo 的 `gpt-image-2` 这里不要直接传 `16:9`、`1:1` 这种比例，建议传像素尺寸。

常用映射：

| 目标比例 | 1K | 2K | 4K |
| --- | --- | --- | --- |
| 1:1 | 1024x1024 | 2048x2048 | 2880x2880 |
| 16:9 | 1024x576 | 2048x1152 | 3840x2160 |
| 9:16 | 576x1024 | 1152x2048 | 2160x3840 |
| 4:3 | 1024x768 | 2048x1536 | 3328x2496 |
| 3:4 | 768x1024 | 1536x2048 | 2496x3328 |
| 21:9 | 1024x432 | 2048x880 | 3840x1648 |
| 1:3 | 1024x3072 | 1360x4080 不建议 | 不建议 |

建议默认：

- 普通头像/资产图：`1024x1024`
- 横屏分镜/场景：`2048x1152`
- 竖屏图：`1152x2048`
- 高稳定性优先：先用 1K
- 质量优先且上游稳定：再用 2K

不要随便传超大尺寸。比较稳的限制：

- 宽高最好都是 16 的倍数。
- 最长边不要超过 `3840`。
- 宽高比不要超过 `3:1` 或 `1:3`。
- 总像素不要超过约 `8,294,400`。

## 5. quality 和输出格式

推荐：

```json
{
  "quality": "high",
  "output_format": "png"
}
```

可用质量通常写：

- `high`
- `medium`
- `low`

注意：

- 不要写 `format: "png"`。
- 要写 `output_format: "png"`。
- 如果用户传了 `jpg`，建议转成 `jpeg`。

## 6. 多图数量

如果要一次生成多张，把 `n` 放在 tool 里：

```json
{
  "type": "image_generation",
  "model": "gpt-image-2",
  "size": "1024x1024",
  "quality": "high",
  "output_format": "png",
  "n": 2
}
```

建议一次最多 1-4 张。多图、2K、多参考图一起用时更容易慢或失败。

## 7. 结果解析

返回结果里，图片通常在 `output` 数组里的 `image_generation_call` 项。

常见结构：

```json
{
  "id": "resp_xxx",
  "status": "completed",
  "output": [
    {
      "id": "ig_xxx",
      "type": "image_generation_call",
      "status": "completed",
      "result": "<base64 image data>",
      "revised_prompt": "..."
    }
  ]
}
```

解析方式：

1. 遍历 `response.output`。
2. 找 `type === "image_generation_call"` 的对象。
3. 优先读 `result`。
4. 如果 `result` 是纯 base64，拼成：

```text
data:image/png;base64,<result>
```

5. 如果有 `url`、`image_url`、`output_url`、`file_url`，也要兼容读取。

建议兼容这些字段：

```text
output[].result
output[].url
output[].image_url
output[].output_url
data[].url
data[].b64_json
url
image_url
```

## 8. 轮询处理

有时首次 `/responses` 返回里没有图片，但有 response id，状态可能是：

```json
{
  "id": "resp_xxx",
  "status": "in_progress"
}
```

这时应该轮询：

```text
GET https://aizahuo.shop/v1/responses/resp_xxx
```

请求头仍然带：

```http
Authorization: Bearer <AIZAHUO_API_KEY>
```

轮询建议：

- 每 3 秒查一次。
- 最多等 8 分钟。
- `status` 是 `failed`、`error`、`cancelled`、`canceled` 时直接失败。
- `status` 是 `completed` 且能解析到图片时成功。
- 即使某个 `image_generation_call.status` 还显示 `generating`，只要 `result` 已经有图片，也可以当成功处理。

## 9. 推荐封装伪代码

```ts
async function generateImageWithAizahuoGptImage2(input) {
  const body = {
    model: input.responsesModel || "gpt-5.5",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: input.prompt },
          ...input.referenceImageUrls.map((url) => ({
            type: "input_image",
            image_url: url
          }))
        ]
      }
    ],
    stream: false,
    tool_choice: { type: "image_generation" },
    tools: [
      {
        type: "image_generation",
        model: "gpt-image-2",
        size: input.pixelSize || "1024x1024",
        quality: input.quality || "high",
        output_format: input.outputFormat || "png",
        ...(input.n && input.n > 1 ? { n: input.n } : {})
      }
    ]
  };

  let response = await postJson("https://aizahuo.shop/v1/responses", body);
  let image = extractImage(response);
  if (image) return image;

  if (!response.id) throw new Error("No image and no response id returned");

  for (let i = 0; i < 160; i++) {
    await sleep(3000);
    response = await getJson(`https://aizahuo.shop/v1/responses/${response.id}`);
    image = extractImage(response);
    if (image) return image;
    if (["failed", "error", "cancelled", "canceled"].includes(String(response.status).toLowerCase())) {
      throw new Error(JSON.stringify(response.error || response));
    }
  }

  throw new Error("Image generation timed out");
}
```

## 10. 最容易踩的坑

- 错误：`POST /v1/images/generations`，顶层写 `model: "gpt-image-2"`。
  正确：`POST /v1/responses`，外层 `model: "gpt-5.5"`，tool 里写 `model: "gpt-image-2"`。

- 错误：顶层写 `prompt`。
  正确：写到 `input[0].content` 的 `input_text.text`。

- 错误：用 `image_urls` 传参考图。
  正确：在 `input[0].content` 里追加 `{ "type": "input_image", "image_url": "..." }`。

- 错误：传 `size: "16:9"`。
  正确：传 `size: "2048x1152"` 这类像素尺寸。

- 错误：传 `format: "png"`。
  正确：传 `output_format: "png"`。

- 错误：只解析 `data[0].url`。
  正确：重点解析 `output[].type === "image_generation_call"` 的 `result`，并兼容 base64。

- 错误：请求返回没图就立即失败。
  正确：如果返回了 `id`，轮询 `/v1/responses/{id}`。

- 错误：生成出的上游 URL 直接长期存库。
  正确：如果返回 URL，最好下载后存到自己的存储；如果返回 base64，decode 后保存。

- 错误：多参考图 + 2K/4K + 超长 prompt 默认一起提交。
  正确：先用 1K 验证链路；稳定后再加参考图和 2K。多参考图建议控制在 1-4 张。

## 11. 最推荐的默认参数

文本生图：

```json
{
  "responsesModel": "gpt-5.5",
  "imageModel": "gpt-image-2",
  "size": "1024x1024",
  "quality": "high",
  "output_format": "png"
}
```

横屏参考图生图：

```json
{
  "responsesModel": "gpt-5.5",
  "imageModel": "gpt-image-2",
  "size": "2048x1152",
  "quality": "high",
  "output_format": "png",
  "referenceImageUrls": ["https://example.com/ref.png"]
}
```

如果不确定上游稳定性，先把 `size` 改成 `1024x576` 或 `1024x1024`。
