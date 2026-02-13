// 存储模块 - 简洁版本，无迁移逻辑

pub mod config;
pub mod schema;

pub use config::{get_storage_config, init_storage};
pub use schema::*;
