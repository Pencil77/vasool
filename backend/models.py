from sqlalchemy import Column, Integer, String, ForeignKey, Numeric
from sqlalchemy.orm import relationship
import enum
from database import Base


class RoleEnum(str, enum.Enum):
    LEADER = "LEADER"
    PERMANENT = "PERMANENT"
    TEMPORARY = "TEMPORARY"


class StatusEnum(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    name = Column(String)

    gangs_created = relationship("Gang", back_populates="leader")
    participants = relationship("GangParticipant", back_populates="user")


class Gang(Base):
    __tablename__ = "gangs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    leader_id = Column(Integer, ForeignKey("users.id"))

    leader = relationship("User", back_populates="gangs_created")
    participants = relationship("GangParticipant", back_populates="gang")
    expenses = relationship("Expense", back_populates="gang")


class GangParticipant(Base):
    __tablename__ = "gang_participants"

    id = Column(Integer, primary_key=True, index=True)
    gang_id = Column(Integer, ForeignKey("gangs.id"))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    display_name = Column(String, nullable=True)
    role = Column(String, default=RoleEnum.TEMPORARY.value)
    status = Column(String, default=StatusEnum.PENDING.value)
    delegated_to_id = Column(Integer, ForeignKey("gang_participants.id"), nullable=True)

    gang = relationship("Gang", back_populates="participants")
    user = relationship("User", back_populates="participants")

    delegates = relationship("GangParticipant", back_populates="delegated_to")
    delegated_to = relationship(
        "GangParticipant", back_populates="delegates", remote_side=[id]
    )

    expenses_paid = relationship("Expense", back_populates="paid_by")
    expense_splits = relationship("ExpenseSplit", back_populates="participant")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    gang_id = Column(Integer, ForeignKey("gangs.id"))
    description = Column(String)
    total_amount = Column(Numeric(10, 2))
    paid_by_id = Column(Integer, ForeignKey("gang_participants.id"))

    gang = relationship("Gang", back_populates="expenses")
    paid_by = relationship("GangParticipant", back_populates="expenses_paid")
    splits = relationship("ExpenseSplit", back_populates="expense")


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"

    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, ForeignKey("expenses.id"))
    participant_id = Column(Integer, ForeignKey("gang_participants.id"))
    amount_owed = Column(Numeric(10, 2))

    expense = relationship("Expense", back_populates="splits")
    participant = relationship("GangParticipant", back_populates="expense_splits")
