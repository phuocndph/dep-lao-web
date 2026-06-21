import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import type { Request } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'

interface RequestWithUser extends Request {
  user: { userId: string; tenantId: string; role: string }
}

@Controller('/api')
@UseGuards(JwtAuthGuard)
export class CrmController {
  constructor(private readonly prisma: PrismaService) {}

  // ── Contacts ──────────────────────────────────────────────────────────────────

  @Get('contacts')
  async listContacts(
    @Query('search') search: string | undefined,
    @Query('labelId') labelId: string | undefined,
    @Query('limit') limitStr: string | undefined,
    @Query('offset') offsetStr: string | undefined,
    @Req() req: RequestWithUser,
  ) {
    const { tenantId } = req.user
    const limit = Math.min(parseInt(limitStr ?? '100', 10) || 100, 500)
    const offset = parseInt(offsetStr ?? '0', 10) || 0

    const where: Record<string, unknown> = { tenantId }
    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { zaloUid: { contains: search } },
      ]
    }
    if (labelId) {
      where.labels = { some: { labelId } }
    }

    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        include: {
          labels: { include: { label: true } },
          _count: { select: { contactNotes: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.contact.count({ where }),
    ])

    return { contacts, total }
  }

  @Get('contacts/:id')
  async getContact(@Param('id') id: string, @Req() req: RequestWithUser) {
    const { tenantId } = req.user
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId },
      include: {
        labels: { include: { label: true } },
        contactNotes: { orderBy: { createdAt: 'desc' } },
        messages: { orderBy: { sentAt: 'desc' }, take: 5 },
      },
    })
    if (!contact) throw new HttpException('Not found', HttpStatus.NOT_FOUND)
    return contact
  }

  @Post('contacts')
  async createContact(
    @Body() body: { zaloUid?: string; phone?: string; displayName?: string; realName?: string; notes?: string; source?: string },
    @Req() req: RequestWithUser,
  ) {
    const { tenantId } = req.user
    return this.prisma.contact.create({
      data: {
        tenantId,
        zaloUid: body.zaloUid ?? '',
        phone: body.phone ?? null,
        displayName: body.displayName ?? null,
        realName: body.realName ?? null,
        notes: body.notes ?? null,
        source: body.source ?? null,
      },
    })
  }

  @Put('contacts/:id')
  async updateContact(
    @Param('id') id: string,
    @Body() body: { phone?: string; displayName?: string; realName?: string; notes?: string },
    @Req() req: RequestWithUser,
  ) {
    const { tenantId } = req.user
    const existing = await this.prisma.contact.findFirst({ where: { id, tenantId } })
    if (!existing) throw new HttpException('Not found', HttpStatus.NOT_FOUND)
    return this.prisma.contact.update({
      where: { id },
      data: {
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.displayName !== undefined && { displayName: body.displayName }),
        ...(body.realName !== undefined && { realName: body.realName }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
    })
  }

  @Delete('contacts/:id')
  async deleteContact(@Param('id') id: string, @Req() req: RequestWithUser): Promise<{ removed: boolean }> {
    const { tenantId } = req.user
    const existing = await this.prisma.contact.findFirst({ where: { id, tenantId } })
    if (!existing) throw new HttpException('Not found', HttpStatus.NOT_FOUND)
    await this.prisma.contact.delete({ where: { id } })
    return { removed: true }
  }

  // ── Contact Labels ────────────────────────────────────────────────────────────

  @Post('contacts/:id/labels')
  async assignLabel(
    @Param('id') contactId: string,
    @Body() body: { labelId: string },
    @Req() req: RequestWithUser,
  ) {
    const { tenantId } = req.user
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, tenantId } })
    if (!contact) throw new HttpException('Contact not found', HttpStatus.NOT_FOUND)
    const label = await this.prisma.label.findFirst({ where: { id: body.labelId, tenantId } })
    if (!label) throw new HttpException('Label not found', HttpStatus.NOT_FOUND)
    await this.prisma.contactLabel.upsert({
      where: { contactId_labelId: { contactId, labelId: body.labelId } },
      create: { contactId, labelId: body.labelId },
      update: {},
    })
    return { assigned: true }
  }

  @Delete('contacts/:id/labels/:labelId')
  async removeLabel(
    @Param('id') contactId: string,
    @Param('labelId') labelId: string,
    @Req() req: RequestWithUser,
  ): Promise<{ removed: boolean }> {
    const { tenantId } = req.user
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, tenantId } })
    if (!contact) throw new HttpException('Contact not found', HttpStatus.NOT_FOUND)
    await this.prisma.contactLabel.deleteMany({ where: { contactId, labelId } })
    return { removed: true }
  }

  // ── Labels ────────────────────────────────────────────────────────────────────

  @Get('labels')
  async listLabels(@Req() req: RequestWithUser) {
    return this.prisma.label.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { createdAt: 'asc' },
    })
  }

  @Post('labels')
  async createLabel(
    @Body() body: { name: string; color?: string },
    @Req() req: RequestWithUser,
  ) {
    const { tenantId } = req.user
    if (!body.name) throw new HttpException('name is required', HttpStatus.BAD_REQUEST)
    return this.prisma.label.create({
      data: { tenantId, name: body.name, color: body.color ?? '#6366f1' },
    })
  }

  @Put('labels/:id')
  async updateLabel(
    @Param('id') id: string,
    @Body() body: { name?: string; color?: string },
    @Req() req: RequestWithUser,
  ) {
    const { tenantId } = req.user
    const existing = await this.prisma.label.findFirst({ where: { id, tenantId } })
    if (!existing) throw new HttpException('Not found', HttpStatus.NOT_FOUND)
    return this.prisma.label.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.color !== undefined && { color: body.color }),
      },
    })
  }

  @Delete('labels/:id')
  async deleteLabel(@Param('id') id: string, @Req() req: RequestWithUser): Promise<{ removed: boolean }> {
    const { tenantId } = req.user
    const existing = await this.prisma.label.findFirst({ where: { id, tenantId } })
    if (!existing) throw new HttpException('Not found', HttpStatus.NOT_FOUND)
    await this.prisma.label.delete({ where: { id } })
    return { removed: true }
  }

  // ── Contact Notes ─────────────────────────────────────────────────────────────

  @Get('contacts/:id/notes')
  async listNotes(@Param('id') contactId: string, @Req() req: RequestWithUser) {
    const { tenantId } = req.user
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, tenantId } })
    if (!contact) throw new HttpException('Not found', HttpStatus.NOT_FOUND)
    return this.prisma.contactNote.findMany({
      where: { contactId, tenantId },
      orderBy: { createdAt: 'desc' },
    })
  }

  @Post('contacts/:id/notes')
  async createNote(
    @Param('id') contactId: string,
    @Body() body: { content: string },
    @Req() req: RequestWithUser,
  ) {
    const { tenantId, userId } = req.user
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, tenantId } })
    if (!contact) throw new HttpException('Not found', HttpStatus.NOT_FOUND)
    if (!body.content) throw new HttpException('content is required', HttpStatus.BAD_REQUEST)
    return this.prisma.contactNote.create({
      data: { tenantId, contactId, content: body.content, createdBy: userId },
    })
  }

  @Delete('contacts/:id/notes/:noteId')
  async deleteNote(
    @Param('id') contactId: string,
    @Param('noteId') noteId: string,
    @Req() req: RequestWithUser,
  ): Promise<{ removed: boolean }> {
    const { tenantId } = req.user
    await this.prisma.contactNote.deleteMany({ where: { id: noteId, contactId, tenantId } })
    return { removed: true }
  }

  // Convenience: delete note by noteId only (no contactId needed)
  @Delete('notes/:noteId')
  async deleteNoteById(
    @Param('noteId') noteId: string,
    @Req() req: RequestWithUser,
  ): Promise<{ removed: boolean }> {
    const { tenantId } = req.user
    await this.prisma.contactNote.deleteMany({ where: { id: noteId, tenantId } })
    return { removed: true }
  }
}
