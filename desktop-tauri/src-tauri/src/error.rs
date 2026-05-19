use std::fmt;

#[derive(Debug, Clone)]
pub enum AppError {
    /// API Key 无效、Access Token 过期、未授权访问
    AuthFailure(String),
    /// 请求频率过高被限流
    RateLimited(String),
    /// 目标资料或游戏库为私密
    PrivateLibrary(String),
    /// 网络连接失败（DNS/TCP/TLS/超时）
    NetworkFailure(String),
    /// 响应数据格式异常或 JSON 解析失败
    DataFormat(String),
    /// 输入参数不合法（必填字段缺失、格式错误）
    InputValidation(String),
    /// 请求的资源不存在
    NotFound(String),
    /// 内部错误（数据库、文件系统等）
    Internal(String),
}

impl AppError {
    /// 根据 HTTP 状态码分类错误
    pub fn from_http_status(status: reqwest::StatusCode, context: &str) -> Self {
        match status.as_u16() {
            401 => Self::AuthFailure(format!("{context}：鉴权失败（HTTP 401）")),
            403 => Self::PrivateLibrary(format!("{context}：访问被拒绝（HTTP 403），可能为私密资料")),
            404 => Self::NotFound(format!("{context}：资源不存在（HTTP 404）")),
            429 => Self::RateLimited(format!("{context}：请求过于频繁，请稍后重试（HTTP 429）")),
            500..=599 => Self::Internal(format!(
                "{context}：服务器内部错误（HTTP {status}）"
            )),
            _ => Self::Internal(format!("{context}：HTTP {status}")),
        }
    }

    /// 从 reqwest 网络错误构造
    pub fn from_reqwest(error: reqwest::Error, context: &str) -> Self {
        if error.is_timeout() {
            Self::NetworkFailure(format!("{context}：请求超时"))
        } else if error.is_connect() {
            Self::NetworkFailure(format!("{context}：无法连接到服务器"))
        } else if error.is_body() || error.is_decode() {
            Self::DataFormat(format!("{context}：响应数据读取失败"))
        } else {
            Self::NetworkFailure(format!("{context}：网络请求失败"))
        }
    }

    /// 用户可读的中文错误消息
    pub fn user_message(&self) -> String {
        match self {
            Self::AuthFailure(msg) => msg.clone(),
            Self::RateLimited(msg) => msg.clone(),
            Self::PrivateLibrary(msg) => msg.clone(),
            Self::NetworkFailure(msg) => msg.clone(),
            Self::DataFormat(msg) => msg.clone(),
            Self::InputValidation(msg) => msg.clone(),
            Self::NotFound(msg) => msg.clone(),
            Self::Internal(msg) => msg.clone(),
        }
    }

    /// 错误变体名称（用于日志）
    pub fn variant_name(&self) -> &'static str {
        match self {
            Self::AuthFailure(_) => "AuthFailure",
            Self::RateLimited(_) => "RateLimited",
            Self::PrivateLibrary(_) => "PrivateLibrary",
            Self::NetworkFailure(_) => "NetworkFailure",
            Self::DataFormat(_) => "DataFormat",
            Self::InputValidation(_) => "InputValidation",
            Self::NotFound(_) => "NotFound",
            Self::Internal(_) => "Internal",
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.user_message())
    }
}

impl From<AppError> for String {
    fn from(error: AppError) -> Self {
        error.user_message()
    }
}
