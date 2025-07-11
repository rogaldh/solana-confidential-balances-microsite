'use client'

import { FC, type PropsWithChildren } from 'react'
import { Toaster } from '@solana-foundation/ms-tools-ui/components/sonner'
import { WalletConnection } from '@/entities/wallet/connection/ui/wallet-connection'
import { ClusterProvider } from './providers/cluster-provider'
import { SolanaProvider } from './providers/solana-provider'
import { JotaiProvider, ReactQueryProvider } from './providers/state-providers'

export const App: FC<PropsWithChildren> = ({ children }) => (
  <JotaiProvider>
    <ReactQueryProvider>
      <ClusterProvider>
        <SolanaProvider>
          {children}
          <Toaster position="bottom-center" />
          <WalletConnection className="fixed top-12 left-1/2 z-50 max-w-sm -translate-x-1/2" />
        </SolanaProvider>
      </ClusterProvider>
    </ReactQueryProvider>
  </JotaiProvider>
)
