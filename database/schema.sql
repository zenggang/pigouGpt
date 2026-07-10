create table if not exists users (
  id bigint unsigned not null auto_increment,
  email varchar(191) not null,
  name varchar(191) null,
  role varchar(32) not null default 'user',
  password_hash varchar(255) null,
  is_enabled tinyint(1) not null default 1,
  last_login_at datetime(3) null,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (id),
  unique key uk_users_email (email),
  key idx_users_enabled (is_enabled)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists user_sessions (
  id bigint unsigned not null auto_increment,
  user_id bigint unsigned not null,
  token_hash char(64) not null,
  expires_at datetime(3) not null,
  created_at datetime(3) not null default current_timestamp(3),
  primary key (id),
  unique key uk_user_sessions_token_hash (token_hash),
  key idx_user_sessions_user_expires (user_id, expires_at),
  constraint fk_user_sessions_user foreign key (user_id) references users(id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists conversations (
  id varchar(64) not null,
  user_id bigint unsigned not null,
  title varchar(191) not null default '新的会话',
  model varchar(32) not null default 'gpt-5.6-sol',
  mode varchar(32) not null default 'chat',
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (id),
  key idx_conversations_user_updated (user_id, updated_at),
  constraint fk_conversations_user foreign key (user_id) references users(id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists messages (
  id varchar(64) not null,
  conversation_id varchar(64) not null,
  user_id bigint unsigned not null,
  role varchar(32) not null,
  content longtext not null,
  thinking longtext null,
  images_json longtext null,
  usage_json text null,
  status varchar(32) not null default 'done',
  error_message varchar(500) null,
  upstream_response_id varchar(191) null,
  created_at datetime(3) not null default current_timestamp(3),
  primary key (id),
  key idx_messages_conversation_created (conversation_id, created_at),
  key idx_messages_user_created (user_id, created_at),
  constraint fk_messages_conversation foreign key (conversation_id) references conversations(id) on delete cascade,
  constraint fk_messages_user foreign key (user_id) references users(id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists image_jobs (
  id varchar(64) not null,
  user_id bigint unsigned not null,
  conversation_id varchar(64) not null,
  assistant_message_id varchar(64) not null,
  prompt longtext not null,
  model varchar(32) not null,
  reasoning_effort varchar(32) not null default 'low',
  status varchar(32) not null default 'queued',
  error_message varchar(500) null,
  images_json longtext null,
  usage_json text null,
  upstream_response_id varchar(191) null,
  started_at datetime(3) null,
  completed_at datetime(3) null,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (id),
  key idx_image_jobs_user_created (user_id, created_at),
  key idx_image_jobs_conversation (conversation_id),
  key idx_image_jobs_assistant_message (assistant_message_id),
  key idx_image_jobs_status_created (status, created_at)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
