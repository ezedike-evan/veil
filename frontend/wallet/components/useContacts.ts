'use client'

import { useState, useEffect } from 'react'
import { StrKey } from '@stellar/stellar-sdk'

export interface Contact {
  id: string
  name: string
  address: string
}

const STORAGE_KEY = 'veil_contacts'

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  // Load contacts from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        setContacts(JSON.parse(saved))
      } catch (err) {
        console.error('Failed to parse contacts from localStorage', err)
      }
    }
    setIsLoaded(true)
  }, [])

  // Sync to localStorage whenever contacts change
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts))
    }
  }, [contacts, isLoaded])

  const addContact = (name: string, address: string) => {
    if (!name.trim()) throw new Error('Name is required')
    if (!StrKey.isValidEd25519PublicKey(address)) {
      throw new Error('Invalid Stellar address')
    }

    const newContact: Contact = {
      id: Date.now().toString(),
      name: name.trim(),
      address: address.trim(),
    }

    setContacts(prev => [...prev, newContact])
    return newContact
  }

  const removeContact = (id: string) => {
    setContacts((prev: Contact[]) => prev.filter(c => c.id !== id))
  }

  const updateContact = (id: string, updates: Partial<Omit<Contact, 'id'>>) => {
    setContacts((prev: Contact[]) => prev.map(c => c.id === id ? { ...c, ...updates } : c))
  }

  return {
    contacts,
    isLoaded,
    addContact,
    removeContact,
    updateContact,
  }
}
