#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Env, BytesN};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Signer(BytesN<65>),
}

#[contract]
pub struct MockWallet;

#[contractimpl]
impl MockWallet {
    pub fn init(env: Env, public_key: BytesN<65>) {
        env.storage().persistent().set(&DataKey::Signer(public_key), &());
    }

    pub fn is_signer(env: Env, key: BytesN<65>) -> bool {
        env.storage().persistent().has(&DataKey::Signer(key))
    }
}
