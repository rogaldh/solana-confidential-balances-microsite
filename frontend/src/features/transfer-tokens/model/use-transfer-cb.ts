import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import pluralize from 'pluralize'
import {
  AES_SEED_MESSAGE,
  ELGAMAL_SEED_MESSAGE,
  generateSeedSignature,
  processMultiTransaction,
} from '@/entities/account/account'
import { queryKey as confidentialVisibilityQK } from '@/entities/account/account/model/use-confidential-visibility'
import { queryKey as getBalanceQK } from '@/entities/account/account/model/use-get-balance'
import { queryKey as getSignaturesWithTxQK } from '@/entities/account/account/model/use-get-signatures-with-tx-data'
import { queryKey as getTokenAccountsQK } from '@/entities/account/account/model/use-get-token-accounts'
import { useDevMode } from '@/entities/dev-mode'
import { useOperationLog } from '@/entities/operation-log'
import { serverRequest } from '@/shared/api'
import { useToast } from '@/shared/ui/toast'

export const useTransferCB = ({
  senderTokenAccountPubkey,
}: {
  senderTokenAccountPubkey: PublicKey
}) => {
  const { connection } = useConnection()
  const wallet = useWallet()
  const client = useQueryClient()

  const toast = useToast()
  const log = useOperationLog()
  const devMode = useDevMode()

  return useMutation({
    mutationKey: ['transfer-cb', { endpoint: connection.rpcEndpoint, senderTokenAccountPubkey }],
    mutationFn: async ({
      amount,
      recipientAddress,
      mintAddress,
    }: {
      amount: number
      recipientAddress: string
      mintAddress: string
    }) => {
      try {
        if (!wallet.publicKey) {
          throw new Error('Wallet not connected')
        }

        // First, sign the messages for ElGamal and AES
        if (!wallet.signMessage) {
          throw new Error('Wallet does not support message signing')
        }

        // Sign the ElGamal message
        const elGamalSignature = await generateSeedSignature(wallet, ELGAMAL_SEED_MESSAGE)
        const elGamalSignatureBase64 = Buffer.from(elGamalSignature).toString('base64')
        console.log('ElGamal base64 signature:', elGamalSignatureBase64)

        // Sign the AES message
        const aesSignature = await generateSeedSignature(wallet, AES_SEED_MESSAGE)
        const aesSignatureBase64 = Buffer.from(aesSignature).toString('base64')
        console.log('AES base64 signature:', aesSignatureBase64)

        // Get the token account data for sender
        const senderATAInfo = await (async () => {
          const acctInfo = await connection.getAccountInfo(senderTokenAccountPubkey)
          if (!acctInfo) {
            throw new Error('Sender token account not found')
          }
          return acctInfo
        })()

        // Get the token account data for recipient
        const recipientATAInfo = await (async () => {
          const recipientTokenAccountPubkey = new PublicKey(recipientAddress)
          const acctInfo = await connection.getAccountInfo(recipientTokenAccountPubkey)
          if (!acctInfo) {
            throw new Error('Recipient token account not found')
          }
          return acctInfo
        })()

        // Get the mint account data
        const mintAccountInfo = await (async () => {
          const mintAccountPubkey = new PublicKey(mintAddress)
          const acctInfo = await connection.getAccountInfo(mintAccountPubkey)
          if (!acctInfo) {
            throw new Error('Mint account not found')
          }
          return acctInfo
        })()

        // Get the latest blockhash
        const latestBlockhash = await connection.getLatestBlockhash()

        // Step 1: Get the space requirements for each proof account
        console.log('Fetching proof space requirements...')
        const spaceData = await serverRequest('/transfer-cb', undefined, 'GET')
        console.log('Space requirements:', spaceData)

        // Step 2: Calculate rent for each proof account
        console.log('Calculating rent for proof accounts...')
        const equalityProofRent = await connection.getMinimumBalanceForRentExemption(
          spaceData.equality_proof_space
        )
        const ciphertextValidityProofRent = await connection.getMinimumBalanceForRentExemption(
          spaceData.ciphertext_validity_proof_space
        )
        const rangeProofRent = await connection.getMinimumBalanceForRentExemption(
          spaceData.range_proof_space
        )

        console.log('Rent requirements:')
        console.log('- Equality proof rent:', equalityProofRent, 'lamports')
        console.log('- Ciphertext validity proof rent:', ciphertextValidityProofRent, 'lamports')
        console.log('- Range proof rent:', rangeProofRent, 'lamports')

        // Step 3: Call the transfer-cb endpoint with rent information
        console.log('Submitting transfer request...')
        const requestBody = {
          elgamal_signature: elGamalSignatureBase64,
          aes_signature: aesSignatureBase64,
          sender_token_account: Buffer.from(senderATAInfo.data).toString('base64'),
          recipient_token_account: Buffer.from(recipientATAInfo.data).toString('base64'),
          mint_token_account: Buffer.from(mintAccountInfo.data).toString('base64'),
          amount: amount.toString(), // Convert to string to avoid precision issues with large numbers
          priority_fee: '100000000', // Add 0.1 SOL (10,000,000 lamports) priority fee as string
          latest_blockhash: latestBlockhash.blockhash,
          equality_proof_rent: equalityProofRent.toString(),
          ciphertext_validity_proof_rent: ciphertextValidityProofRent.toString(),
          range_proof_rent: rangeProofRent.toString(),
        }

        const data = await serverRequest('/transfer-cb', requestBody)

        const { signatures } = await processMultiTransaction(
          data.transactions,
          wallet,
          connection,
          latestBlockhash,
          'Transfer'
        )

        return {
          signatures,
          amount,
          ...data,
        }
      } catch (error) {
        console.error('Error processing transaction:', error)
        throw error
      }
    },
    onSuccess: (data) => {
      if (data.signatures && data.signatures.length > 0) {
        // Display toast for each signature
        data.signatures.forEach((signature: string) => {
          toast.transaction(signature)
        })
        toast.success('Transfer transaction successful')

        log.push({
          title: 'Transfer Operation - COMPLETE',
          content: `Transfer transaction successful\n  Token account: ${senderTokenAccountPubkey}\n  Amount: ${pluralize('token unit', data.amount, true)}${data.signatures.map((signature: string, index: number) => `\n  Signature${data.signatures.length > 1 ? ` #${index + 1}` : ''}: ${signature}`).join('')}`,
          variant: 'success',
        })

        devMode.set(7, {
          title: 'Transfer Operation - COMPLETE',
          result: `Transfer transaction successful\n  Token account: ${senderTokenAccountPubkey}\n  Amount: ${pluralize('token unit', data.amount, true)}${data.signatures.map((signature: string, index: number) => `\n  Signature${data.signatures.length > 1 ? ` #${index + 1}` : ''}: ${signature}`).join('')}`,
          success: true,
        })
      }

      // Hide confidential balance using query cache
      client.setQueryData(confidentialVisibilityQK(senderTokenAccountPubkey), false)

      // Invalidate relevant queries to refresh data
      return Promise.all([
        client.invalidateQueries({
          queryKey: confidentialVisibilityQK(senderTokenAccountPubkey),
        }),
        client.invalidateQueries({
          queryKey: getBalanceQK(connection.rpcEndpoint, senderTokenAccountPubkey),
        }),
        client.invalidateQueries({
          // cast type for publicKey as it won't be undefiend on success
          queryKey: getSignaturesWithTxQK(connection.rpcEndpoint, wallet.publicKey as PublicKey),
        }),
        client.invalidateQueries({
          queryKey: getTokenAccountsQK(connection.rpcEndpoint, senderTokenAccountPubkey),
        }),
      ])
    },
    onError: (error) => {
      toast.error(`Transfer failed! ${error.message}`)
      log.push({
        title: 'Transfer Operation - FAILED',
        content: `Transfer transaction failed\n  Token account: ${senderTokenAccountPubkey}\n  Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'error',
      })
    },
  })
}
