import { PublicKey } from '@solana/web3.js'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export const queryKey = (address: PublicKey) => [
  'confidential-visibility',
  { address: address.toString() },
]

// Simple hook to manage confidential balance visibility
export const useConfidentialVisibility = (tokenAccountPubkey: PublicKey) => {
  const client = useQueryClient()
  const qk = queryKey(tokenAccountPubkey)

  // Get current visibility state
  const { data: isVisible = false } = useQuery({
    queryKey: qk,
    queryFn: () => false, // Default to hidden
    staleTime: Infinity, // Don't refetch automatically
  })

  // Function to show confidential balance
  const showBalance = () => {
    client.setQueryData(qk, true)
  }

  // Function to hide confidential balance
  const hideBalance = () => {
    client.setQueryData(qk, false)
  }

  return { isVisible, showBalance, hideBalance }
}
