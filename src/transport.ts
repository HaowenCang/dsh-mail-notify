/**
 * The SMTP transport seam.
 *
 * One narrow interface — create a transport, hand it a message — so the send
 * path can be exercised against a stub without a socket. This is the only place
 * in the plugin that names a transport at all.
 *
 * @module dsh-mail-notify/transport
 */

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

/** The message this plugin sends. Plain text only; attachments are a non-goal. */
export interface OutgoingMessage {
  from: string
  to: readonly string[]
  subject: string
  text: string
}

/** The transport surface the mailer consumes. */
export interface MailTransport {
  sendMail(message: OutgoingMessage): Promise<unknown>
}

/** Transport construction inputs; the password is used and then dropped. */
export interface TransportOptions {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}

/** Creates one transport per send operation. */
export type TransportFactory = (options: TransportOptions) => MailTransport

/**
 * Create a real Nodemailer SMTP transport.
 *
 * Certificate validation is left at its default, which is *on*. There is no
 * `tls` block and no `rejectUnauthorized` key anywhere in this package, so
 * "TLS verification cannot be switched off" is a property of the code rather
 * than a promise in a document. An operator hitting a self-signed certificate
 * must supply a trust chain, not a flag.
 *
 * @param options - host, port, TLS mode, and the per-attempt credential.
 * @returns the transport.
 */
export const createSmtpTransport: TransportFactory = (options) => {
  const transporter: Transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.user, pass: options.password },
  })
  return {
    async sendMail(message: OutgoingMessage): Promise<unknown> {
      return transporter.sendMail({
        from: message.from,
        to: [...message.to],
        subject: message.subject,
        text: message.text,
      })
    },
  }
}
