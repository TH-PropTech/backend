export interface UserPayload {
  _id?: string
  email?: string
  name?: string
  username?: string
  roles?: string[]
  keycloakUserId?: string
  kycStatus?: string
}

export interface KeycloakUser {
  _id?: string
  keycloakUserId: string
  username: string
  email?: string
  name?: string
  roles?: string[]

  kycStatus?: string
}

export interface TokenResponse {
  accessToken: string
  refreshToken: string
}

export interface KeycloakTokenPayload {
  sub: string
  preferred_username: string
  email?: string
  name?: string
  realm_access?: {
    roles: string[]
  }

  kid?: string
  alg?: string
}
