// HTTP 响应体的读取边界：所有会把网络响应读进内存的地方共用这一处。
//
// 之前各处都是 `resp.bytes().await` —— 先把**完整** body 收进内存，之后才按
// 2MB / 10MB 截断。对没有 Content-Length 的 chunked 响应（或声称很小却一直发的服务器），
// 截断发生得太晚：内存在到达那一行之前就已经吃满了。
//
// Content-Length 预检也挡不住：那个头是服务器自己说的，可以缺失，也可以撒谎。
// 唯一可靠的做法是**边读边计量**，超过上限立刻停止并丢弃剩余流。

use futures::StreamExt;

/// 流式读取响应体，累计到 `max_bytes` 就停止。
///
/// 返回 `(数据, 是否被截断)`。截断时返回的是前 `max_bytes` 字节，
/// 剩余流被丢弃（连接随 Response 一起 drop）。
pub async fn read_capped(
    resp: reqwest::Response,
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), String> {
    // Content-Length 只用来**提前**拒绝明显超限的响应，省掉一次无谓的下载；
    // 没有它或它撒谎时，下面的流式计量才是真正的边界。
    if let Some(len) = resp.content_length() {
        if len > max_bytes as u64 {
            return Ok((Vec::new(), true));
        }
    }

    let mut out: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取响应失败: {}", e))?;
        if out.len() + chunk.len() > max_bytes {
            let take = max_bytes.saturating_sub(out.len());
            out.extend_from_slice(&chunk[..take]);
            return Ok((out, true)); // 立刻收工，不再拉取后续 chunk
        }
        out.extend_from_slice(&chunk);
    }
    Ok((out, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 起一个**无限**发送的 chunked 服务器（不带 Content-Length），
    /// 验证读取在上限处停下来，而不是一直涨到把内存吃光。
    #[tokio::test]
    async fn unbounded_chunked_response_stops_at_limit() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf).await;
            // 没有 Content-Length，chunked 编码，然后一直发
            sock.write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/plain\r\n\r\n",
            )
            .await
            .unwrap();
            let payload = "x".repeat(4096);
            loop {
                let chunk = format!("{:x}\r\n{}\r\n", payload.len(), payload);
                if sock.write_all(chunk.as_bytes()).await.is_err() {
                    break; // 客户端已断开 = 我们确实提前停了
                }
            }
        });

        let max = 64 * 1024;
        let resp = reqwest::get(format!("http://{}/", addr)).await.unwrap();
        let (body, truncated) = read_capped(resp, max).await.unwrap();

        assert!(truncated, "无限响应必须被标记为截断");
        assert_eq!(body.len(), max, "读取量必须恰好停在上限");

        server.abort();
    }

    #[tokio::test]
    async fn small_response_is_returned_intact() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf).await;
            sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello")
                .await
                .unwrap();
        });

        let resp = reqwest::get(format!("http://{}/", addr)).await.unwrap();
        let (body, truncated) = read_capped(resp, 1024).await.unwrap();
        assert!(!truncated);
        assert_eq!(body, b"hello");
    }

    /// Content-Length 声称超限时应当**在下载之前**就拒绝
    #[tokio::test]
    async fn oversized_content_length_short_circuits() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf).await;
            let body = "y".repeat(10_000);
            let _ = sock
                .write_all(
                    format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}", body.len(), body)
                        .as_bytes(),
                )
                .await;
        });

        let resp = reqwest::get(format!("http://{}/", addr)).await.unwrap();
        let (body, truncated) = read_capped(resp, 100).await.unwrap();
        assert!(truncated);
        assert!(body.is_empty(), "超限时不该把 body 读进来");
    }
}
